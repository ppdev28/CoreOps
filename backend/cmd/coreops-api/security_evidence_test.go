package main

import (
	"context"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type completeEvidence struct {
	securityFixture
	reads int
}

func (f *completeEvidence) Posture(context.Context) (core.Posture, error) {
	f.reads++
	return core.Posture{Sensors: []core.Sensor{}, Sources: map[string]core.SourceStatus{}}, nil
}
func (f *completeEvidence) SSHPolicy(_ context.Context, c core.SSHContext) (core.SSHPolicy, error) {
	f.reads++
	return core.SSHPolicy{Context: c, Checks: []core.Check{}, Source: core.SourceStatus{State: "ok"}}, nil
}
func (f *completeEvidence) Events(context.Context, core.EventQuery) (core.EventPage, error) {
	f.reads++
	return core.EventPage{Events: []core.Event{}, Signals: []core.Signal{}, Source: core.SourceStatus{State: "ok"}}, nil
}

type httpScanRunner struct {
	reads atomic.Int32
	scans atomic.Int32
	hook  func()
}

func (s *httpScanRunner) Capabilities(context.Context) (core.ScanCapability, error) {
	s.reads.Add(1)
	if s.hook != nil {
		s.hook()
	}
	return core.ScanCapability{Available: true, Hostname: "owned", BootID: "boot", Targets: []core.ScanTarget{{ID: "host", Label: "Host OS"}}}, nil
}
func (s *httpScanRunner) Scan(context.Context, string) (core.ScanReport, error) {
	s.scans.Add(1)
	return core.ScanReport{Packages: 1, Vulnerabilities: []core.Vulnerability{}}, nil
}
func TestSecurityEvidenceRoleCacheAndStrictQueries(t *testing.T) {
	auth := guardSecurityAuth(t)
	for _, role := range []Role{RoleViewer, RoleOperator} {
		auth.users[string(role)] = User{Name: string(role), Role: role}
		auth.sessions[tokenKey(string(role))] = session{User: string(role), Expires: time.Now().Add(time.Hour)}
	}
	if e := auth.save(usersFileName, auth.users); e != nil {
		t.Fatal(e)
	}
	if e := auth.save(sessionsFileName, auth.sessions); e != nil {
		t.Fatal(e)
	}
	f := &completeEvidence{}
	api := &API{hostSecurity: core.New(f)}
	audit := NewAuditLog(auth.dir)
	handler := withAudit(audit, api.routes(auth, audit))
	defer api.terminals.Close()
	request := func(path, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Header().Get("Cache-Control") != "no-store, private" {
			t.Fatal("sensitive response cached", path, w.Header())
		}
		return w
	}
	for _, path := range []string{"/api/v1/security/posture", "/api/v1/security/ssh-policy?user=pepe&address=192.0.2.1", "/api/v1/security/events?category=tailscale&direction=older&limit=1", "/api/v1/security/scans/capabilities", "/api/v1/security/scans", "/api/v1/security/monitor"} {
		for _, tc := range []struct {
			token string
			want  int
		}{{"", 401}, {"viewer", 403}, {"operator", 200}, {"guard-token", 200}} {
			if w := request(path, tc.token); w.Code != tc.want {
				t.Fatal(path, tc, w.Code, w.Body.String())
			}
		}
	}
	before := f.reads
	for _, path := range []string{"/api/v1/security/ssh-policy?user=--bad&address=192.0.2.1", "/api/v1/security/ssh-policy?user=pepe&address=bad", "/api/v1/security/ssh-policy?user=pepe&address=192.0.2.1&command=id", "/api/v1/security/events?category=all&direction=newer", "/api/v1/security/events?category=all&cursor=bad%0Avalue", "/api/v1/security/events?category=all&limit=999"} {
		if w := request(path, "guard-token"); w.Code != 400 {
			t.Fatal(path, w.Code)
		}
	}
	if f.reads != before {
		t.Fatal("invalid evidence query reached source")
	}
}
func TestSecurityScanRevocationAndAuditFailureBlockWork(t *testing.T) {
	for _, mode := range []string{"revoked", "audit-failed"} {
		t.Run(mode, func(t *testing.T) {
			auth := guardSecurityAuth(t)
			runner := &httpScanRunner{}
			audit := NewAuditLog(auth.dir)
			if mode == "revoked" {
				runner.hook = func() {
					if e := auth.Logout("guard-token"); e != nil {
						t.Fatal(e)
					}
				}
			} else {
				audit = NewAuditLog(filepath.Join(auth.dir, "missing"))
			}
			api := &API{securityScans: core.NewScanJobs(context.Background(), runner), hostSecurity: core.New(&securityFixture{})}
			handler := withAudit(audit, api.routes(auth, audit))
			defer api.terminals.Close()
			r := httptest.NewRequest("POST", "/api/v1/security/scans", strings.NewReader(`{"target":"host","hostname":"owned","bootId":"boot","requestId":"`+strings.Repeat("a", 32)+`"}`))
			r.Header.Set("Authorization", "Bearer guard-token")
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			want := 503
			if mode == "revoked" {
				want = 403
			}
			if w.Code != want || runner.scans.Load() != 0 || len(api.securityScans.Jobs()) != 0 {
				t.Fatal(mode, w.Code, w.Body.String(), runner.scans.Load())
			}
		})
	}
}

type blockingSignal struct {
	securityFixture
	entered, release chan struct{}
}

func (f *blockingSignal) Signal(ctx context.Context, _ core.Session) error {
	close(f.entered)
	select {
	case <-f.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func TestSecurityOperationLinearizesLogoutWithHostEffect(t *testing.T) {
	auth := guardSecurityAuth(t)
	f := &blockingSignal{securityFixture: securityFixture{rows: guardSession()}, entered: make(chan struct{}), release: make(chan struct{})}
	done := make(chan int, 1)
	go func() { done <- guardSecurityRequest(t, auth, f, NewAuditLog(auth.dir)).Code }()
	select {
	case <-f.entered:
	case <-time.After(time.Second):
		t.Fatal("effect did not start")
	}
	loggedOut := make(chan error, 1)
	go func() { loggedOut <- auth.Logout("guard-token") }()
	select {
	case e := <-loggedOut:
		close(f.release)
		t.Fatal("logout completed while authorized effect was in progress", e)
	case <-time.After(20 * time.Millisecond):
	}
	close(f.release)
	if code := <-done; code != 202 {
		t.Fatal(code)
	}
	if e := <-loggedOut; e != nil {
		t.Fatal(e)
	}
	if _, valid := auth.Authenticate("guard-token"); valid {
		t.Fatal("logout did not revoke")
	}
}
