package main

import (
	"context"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type guardRevokingSource struct {
	securityFixture
	revoke func()
}

func (f *guardRevokingSource) Sessions(ctx context.Context) ([]core.Session, core.SourceStatus, error) {
	if f.revoke != nil {
		f.revoke()
	}
	return f.securityFixture.Sessions(ctx)
}
func guardSecurityAuth(t *testing.T) *AuthStore {
	t.Helper()
	a := newTestStore(t)
	a.users["guard-admin"] = User{Name: "guard-admin", Role: RoleAdmin}
	a.sessions[tokenKey("guard-token")] = session{User: "guard-admin", Expires: time.Now().Add(time.Hour)}
	if e := a.save(usersFileName, a.users); e != nil {
		t.Fatal(e)
	}
	if e := a.save(sessionsFileName, a.sessions); e != nil {
		t.Fatal(e)
	}
	return a
}
func guardSecurityRequest(t *testing.T, a *AuthStore, source core.Source, audit *AuditLog) *httptest.ResponseRecorder {
	t.Helper()
	api := &API{hostSecurity: core.New(source)}
	handler := withAudit(audit, api.routes(a, audit))
	defer api.terminals.Close()
	r := httptest.NewRequest("POST", "/api/v1/security/sessions/12345/terminate", strings.NewReader(`{"id":"`+strings.Repeat("a", 64)+`"}`))
	r.Header.Set("Authorization", "Bearer guard-token")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}
func guardSession() []core.Session {
	return []core.Session{{ID: strings.Repeat("a", 64), PID: 12345, User: "owned-fake", Verified: true, CanTerminate: true}}
}
func TestSecurityRevocationDuringLookupBlocksDispatch(t *testing.T) {
	a := guardSecurityAuth(t)
	f := &guardRevokingSource{securityFixture: securityFixture{rows: guardSession()}}
	f.revoke = func() {
		if e := a.Logout("guard-token"); e != nil {
			t.Fatal(e)
		}
	}
	w := guardSecurityRequest(t, a, f, NewAuditLog(a.dir))
	if w.Code != 403 || f.calls != 0 {
		t.Fatalf("observed behavior changed: status=%d calls=%d", w.Code, f.calls)
	}
	if _, valid := a.Authenticate("guard-token"); valid {
		t.Fatal("revocation failed")
	}
	t.Log("Revoked session cannot dispatch")
}
func TestSecurityAuditFailureBlocksDispatch(t *testing.T) {
	a := guardSecurityAuth(t)
	f := &securityFixture{rows: guardSession()}
	w := guardSecurityRequest(t, a, f, NewAuditLog(filepath.Join(a.dir, "missing-parent")))
	if w.Code != 503 || f.calls != 0 {
		t.Fatalf("observed behavior changed: status=%d calls=%d", w.Code, f.calls)
	}
	t.Log("Failed audit prevents dispatch")
}
