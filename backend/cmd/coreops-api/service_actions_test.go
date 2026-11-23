package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ppdev28/CoreOps/backend/internal/adapters/linuxservices"
)

type serviceControlFixture struct {
	calls   int
	check   func() error
	execute func() error
}

func (f *serviceControlFixture) Check(context.Context) error {
	if f.check != nil {
		return f.check()
	}
	return nil
}
func (f *serviceControlFixture) Execute(_ context.Context, unit, action string) error {
	f.calls++
	if unit != "alsa-restore.service" || action != "stop" {
		return errors.New("unexpected dispatch")
	}
	if f.execute != nil {
		return f.execute()
	}
	return nil
}
func serviceFixtureHandler(t *testing.T) (*API, *AuthStore, *AuditLog, *serviceControlFixture, http.Handler) {
	t.Helper()
	auth, audit := adminFixture(t)
	control := &serviceControlFixture{}
	api := &API{serviceControl: control}
	h := withAudit(audit, api.routes(auth, audit))
	t.Cleanup(api.terminals.Close)
	return api, auth, audit, control, h
}
func TestServicesRolePolicyAndDurableIntent(t *testing.T) {
	_, _, audit, f, h := serviceFixtureHandler(t)
	for _, tc := range []struct {
		token  string
		status int
	}{{"", 401}, {"viewer", 403}, {"operator", 200}, {"admin", 200}} {
		w := adminRequest(h, "POST", "/api/v1/services/alsa-restore.service/stop", tc.token, "")
		if w.Code != tc.status {
			t.Fatal(tc.token, w.Code, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" && tc.status == 200 {
			t.Fatal("cacheable mutation")
		}
	}
	if f.calls != 2 {
		t.Fatal(f.calls)
	}
	data, err := os.ReadFile(audit.path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(data), "Services dispatch requested service stop alsa-restore.service") != 2 {
		t.Fatal("durable intent missing")
	}
}
func TestServicesValidateBeforePrivilege(t *testing.T) {
	_, _, _, f, h := serviceFixtureHandler(t)
	for _, tc := range []struct {
		path, body string
		code       int
	}{
		{"/api/v1/services/-H.service/stop", "", 400},
		{"/api/v1/services/alsa-restore.service/stop?force=1", "", 400},
		{"/api/v1/services/alsa-restore.service/stop", `{"force":true}`, 400},
		{"/api/v1/services/alsa-restore.service/stop", `null`, 400},
		{"/api/v1/services/coreops.service/stop", "", 403},
		{"/api/v1/services/systemd-reboot.service/start", "", 403},
	} {
		w := adminRequest(h, "POST", tc.path, "operator", tc.body)
		if w.Code != tc.code {
			t.Fatal(tc.path, w.Code, w.Body.String())
		}
	}
	if f.calls != 0 {
		t.Fatal("invalid/protected service reached helper")
	}
}
func TestServicesRevocationAndAuditFailurePreventEffect(t *testing.T) {
	for _, mode := range []string{"revoke", "audit", "permission"} {
		t.Run(mode, func(t *testing.T) {
			_, auth, audit, f, h := serviceFixtureHandler(t)
			if mode == "revoke" {
				f.check = func() error { return auth.Logout("operator") }
			}
			if mode == "audit" {
				audit.path = filepath.Join(t.TempDir(), "missing", "audit.log")
			}
			if mode == "permission" {
				f.check = func() error { return linuxservices.ErrPermission }
			}
			w := adminRequest(h, "POST", "/api/v1/services/alsa-restore.service/stop", "operator", "")
			expected := 403
			if mode == "audit" {
				expected = 503
			}
			if w.Code != expected || f.calls != 0 {
				t.Fatal(mode, w.Code, f.calls, w.Body.String())
			}
		})
	}
}
func TestServicesSerializeMutationAndReportUncertain(t *testing.T) {
	api, _, _, f, h := serviceFixtureHandler(t)
	api.serviceMutation.Lock()
	w := adminRequest(h, "POST", "/api/v1/services/alsa-restore.service/stop", "admin", "")
	api.serviceMutation.Unlock()
	if w.Code != 409 || f.calls != 0 {
		t.Fatal("parallel mutation accepted")
	}
	f.execute = func() error { return linuxservices.ErrUncertain }
	w = adminRequest(h, "POST", "/api/v1/services/alsa-restore.service/stop", "admin", "")
	if w.Code != 503 || f.calls != 1 {
		t.Fatal(w.Code, f.calls)
	}
}
func TestServicesIdentityLockCoversEffect(t *testing.T) {
	_, auth, _, f, h := serviceFixtureHandler(t)
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	f.execute = func() error { close(entered); <-release; return nil }
	go func() {
		defer close(done)
		w := adminRequest(h, "POST", "/api/v1/services/alsa-restore.service/stop", "operator", "")
		if w.Code != 200 {
			t.Errorf("status %d", w.Code)
		}
	}()
	<-entered
	revoked := make(chan struct{})
	go func() { auth.Logout("operator"); close(revoked) }()
	select {
	case <-revoked:
		t.Error("logout completed before guarded effect")
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	<-done
	<-revoked
	if _, ok := auth.Authenticate("operator"); ok {
		t.Fatal("revocation lost")
	}
}
