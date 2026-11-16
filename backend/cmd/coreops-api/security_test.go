package main

import (
	"context"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type securityFixture struct {
	calls int
	rows  []core.Session
}

func (f *securityFixture) Probe(context.Context, string) (string, error) {
	return "", &core.SourceError{State: "permission_denied", Detail: "test host permission denied"}
}
func (f *securityFixture) Sessions(context.Context) ([]core.Session, core.SourceStatus, error) {
	return f.rows, core.SourceStatus{State: "ok"}, nil
}
func (f *securityFixture) Signal(context.Context, core.Session) error { f.calls++; return nil }
func (f *securityFixture) CanEnableAutoUpdates(context.Context) core.Capability {
	return core.Capability{Reason: "host denies timer changes"}
}
func (f *securityFixture) EnableAutoUpdates(context.Context) error { f.calls++; return nil }
func TestSecurityRolesIdentityValidationAndAudit(t *testing.T) {
	auth := newTestStore(t)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleAdmin} {
		auth.users[string(role)] = User{Name: string(role), Role: role}
		auth.sessions[tokenKey(string(role))] = session{User: string(role), Expires: time.Now().Add(time.Hour)}
	}
	if e := auth.save(usersFileName, auth.users); e != nil {
		t.Fatal(e)
	}
	if e := auth.save(sessionsFileName, auth.sessions); e != nil {
		t.Fatal(e)
	}
	id := strings.Repeat("a", 64)
	f := &securityFixture{rows: []core.Session{{ID: id, PID: 12345, User: "owned-test", Terminal: "pts/4", Verified: true, CanTerminate: true}}}
	api := &API{hostSecurity: core.New(f)}
	audit := NewAuditLog(auth.dir)
	handler := withAudit(audit, api.routes(auth, audit))
	defer api.terminals.Close()
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	path := "/api/v1/security/sessions/12345/terminate"
	body := `{"id":"` + id + `"}`
	for _, tc := range []struct {
		token     string
		get, post int
	}{{"", 401, 401}, {"viewer", 403, 403}, {"operator", 200, 403}, {"admin", 200, 202}} {
		w := request("GET", "/api/v1/security", tc.token, "")
		if w.Code != tc.get {
			t.Fatal(tc.token, w.Code, w.Body.String())
		}
		w = request("POST", path, tc.token, body)
		if w.Code != tc.post {
			t.Fatal(tc.token, w.Code, w.Body.String())
		}
	}
	if f.calls != 1 {
		t.Fatal("unauthorized signal", f.calls)
	}
	for _, bad := range []string{"", `{}`, body + `{}`, `{"id":"` + id + `","pid":2}`} {
		if w := request("POST", path, "admin", bad); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if w := request("POST", path, "admin", `{"id":"`+strings.Repeat("b", 64)+`"}`); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request("POST", "/api/v1/security/sessions/2026/terminate", "admin", body); w.Code != 404 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request("POST", "/api/v1/security/fix/auto-updates", "operator", ""); w.Code != 403 {
		t.Fatal(w.Code)
	}
	if w := request("POST", "/api/v1/security/fix/auto-updates", "admin", ""); w.Code != 503 {
		t.Fatal(w.Code, w.Body.String())
	}
	if f.calls != 1 {
		t.Fatal("rejected action mutated host")
	}
	data, e := os.ReadFile(filepath.Join(auth.dir, auditFileName))
	if e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(string(data), "SSH termination requested user=owned-test terminal=pts/4 pid=12345") || !strings.Contains(string(data), `"status":403`) {
		t.Fatal("missing audit context")
	}
}
