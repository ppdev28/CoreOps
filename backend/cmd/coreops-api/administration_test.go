package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ppdev28/CoreOps/backend/internal/hostpower"
)

type powerFixture struct {
	calls   int
	inspect func()
}

func (f *powerFixture) Inspect(context.Context) (hostpower.Info, error) {
	if f.inspect != nil {
		f.inspect()
	}
	return hostpower.Info{Hostname: "owned-test", BootID: "test-boot", Actions: []hostpower.Action{{ID: "reboot", Available: true}}}, nil
}
func (f *powerFixture) Execute(context.Context, string) error { f.calls++; return nil }
func adminFixture(t *testing.T) (*AuthStore, *AuditLog) {
	t.Helper()
	auth := newTestStore(t)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleAdmin} {
		auth.users[string(role)] = User{Name: string(role), Role: role}
		auth.sessions[tokenKey(string(role))] = session{User: string(role), Expires: time.Now().Add(time.Hour)}
	}
	if err := auth.save(usersFileName, auth.users); err != nil {
		t.Fatal(err)
	}
	if err := auth.save(sessionsFileName, auth.sessions); err != nil {
		t.Fatal(err)
	}
	return auth, NewAuditLog(auth.dir)
}
func adminRequest(h http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestUserCreationRolesPersistenceValidationAndAudit(t *testing.T) {
	auth, audit := adminFixture(t)
	api := &API{}
	h := withAudit(audit, api.routes(auth, audit))
	defer api.terminals.Close()
	body := `{"name":"new.viewer","password":"` + testPassword + `"}`
	for _, tc := range []struct {
		token  string
		status int
	}{{"", 401}, {"viewer", 403}, {"operator", 403}, {"admin", 201}} {
		if w := adminRequest(h, "POST", "/api/v1/users", tc.token, body); w.Code != tc.status {
			t.Fatal(tc.token, w.Code, w.Body.String())
		}
	}
	if w := adminRequest(h, "POST", "/api/v1/users", "admin", body); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, bad := range []string{`{}`, `{"name":"bad name","password":"` + testPassword + `"}`, `{"name":"bad","password":"short"}`, `{"name":"bad","password":"` + testPassword + `","role":"root"}`, body + `{}`, `{"name":"bad","password":"` + testPassword + `","unknown":true}`} {
		if w := adminRequest(h, "POST", "/api/v1/users", "admin", bad); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	reopened, err := NewAuthStore(auth.dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, user, err := reopened.Login("new.viewer", testPassword, "owned-test"); err != nil || user.Role != RoleViewer {
		t.Fatal("new user cannot log in after restart", err)
	}
	w := adminRequest(h, "GET", "/api/v1/users", "admin", "")
	var users []PublicUser
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &users) != nil || len(users) != 4 {
		t.Fatal(w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "hash") || strings.Contains(w.Body.String(), testPassword) {
		t.Fatal("credentials exposed")
	}
	data, err := os.ReadFile(filepath.Join(auth.dir, auditFileName))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), testPassword) || !strings.Contains(string(data), "create CoreOps user new.viewer role=viewer") {
		t.Fatal("unsafe or missing user audit")
	}
	auth.Logout("admin")
	if err := auth.addUser("revoked", RoleAdmin, testPassword, tokenKey("admin")); !errors.Is(err, errUserCreationDenied) {
		t.Fatal("revoked administrator created account", err)
	}
}
func TestPowerRolesConfirmationReplayAndDurableAudit(t *testing.T) {
	auth, audit := adminFixture(t)
	f := &powerFixture{}
	api := &API{power: hostpower.New(f)}
	h := withAudit(audit, api.routes(auth, audit))
	defer api.terminals.Close()
	body := `{"action":"reboot","hostname":"owned-test","bootId":"test-boot","requestId":"` + strings.Repeat("a", 32) + `"}`
	for _, tc := range []struct {
		token  string
		status int
	}{{"", 401}, {"viewer", 403}, {"operator", 403}, {"admin", 200}} {
		if w := adminRequest(h, "GET", "/api/v1/host/power", tc.token, ""); w.Code != tc.status {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	for _, token := range []string{"", "viewer", "operator"} {
		if w := adminRequest(h, "POST", "/api/v1/host/power", token, body); w.Code < 400 {
			t.Fatal("unauthorized power", w.Code)
		}
	}
	if w := adminRequest(h, "POST", "/api/v1/host/power", "admin", strings.Replace(body, "owned-test", "other", 1)); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, bad := range []string{`{}`, body + `{}`, strings.Replace(body, `"reboot"`, `"reboot --force"`, 1)} {
		if w := adminRequest(h, "POST", "/api/v1/host/power", "admin", bad); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	for i := 0; i < 2; i++ {
		if w := adminRequest(h, "POST", "/api/v1/host/power", "admin", body); w.Code != 202 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if f.calls != 1 {
		t.Fatal("replay or rejected operation reached host", f.calls)
	}
	data, _ := os.ReadFile(audit.path)
	if strings.Count(string(data), "host power dispatch requested") != 1 || !strings.Contains(string(data), `"status":202`) {
		t.Fatal("missing intent/outcome audit")
	}
}
func TestPowerBlocksOnRevocationOrAuditFailure(t *testing.T) {
	for _, reason := range []string{"revoked", "audit"} {
		t.Run(reason, func(t *testing.T) {
			auth, audit := adminFixture(t)
			f := &powerFixture{}
			api := &API{power: hostpower.New(f)}
			h := withAudit(audit, api.routes(auth, audit))
			defer api.terminals.Close()
			if reason == "revoked" {
				f.inspect = func() { auth.Logout("admin") }
			} else {
				audit.path = filepath.Join(t.TempDir(), "absent", "audit.log")
			}
			body := `{"action":"reboot","hostname":"owned-test","bootId":"test-boot","requestId":"` + strings.Repeat("a", 32) + `"}`
			w := adminRequest(h, "POST", "/api/v1/host/power", "admin", body)
			if w.Code < 400 || f.calls != 0 {
				t.Fatal("unsafe dispatch", w.Code, f.calls)
			}
		})
	}
}
