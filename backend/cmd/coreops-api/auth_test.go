package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testPassword = "correct-horse-battery"

func newTestStore(t *testing.T) *AuthStore {
	t.Helper()
	store, err := NewAuthStore(t.TempDir(), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func TestPasswordHashing(t *testing.T) {
	hash, err := hashPassword(testPassword)
	if err != nil {
		t.Fatal(err)
	}
	if !verifyPassword(testPassword, hash) {
		t.Fatal("valid password rejected")
	}
	if verifyPassword("wrong-password-1", hash) {
		t.Fatal("wrong password accepted")
	}
	if verifyPassword(testPassword, "garbage") {
		t.Fatal("malformed hash accepted")
	}
}

func TestAddUserValidation(t *testing.T) {
	store := newTestStore(t)
	if err := store.AddUser("bad name", RoleAdmin, testPassword); err == nil {
		t.Error("invalid user name accepted")
	}
	if err := store.AddUser("alice", "root", testPassword); err == nil {
		t.Error("invalid role accepted")
	}
	if err := store.AddUser("alice", RoleAdmin, "short"); err == nil {
		t.Error("short password accepted")
	}
	if err := store.AddUser("alice", RoleAdmin, testPassword); err != nil {
		t.Fatal(err)
	}
	if err := store.AddUser("alice", RoleAdmin, testPassword); err == nil {
		t.Error("duplicate user accepted")
	}
}

func TestLoginSessionAndExpiry(t *testing.T) {
	store := newTestStore(t)
	now := time.Now()
	store.now = func() time.Time { return now }
	if err := store.AddUser("alice", RoleOperator, testPassword); err != nil {
		t.Fatal(err)
	}
	token, _, _, err := store.Login("alice", testPassword, "10.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	if user, ok := store.Authenticate(token); !ok || user.Name != "alice" {
		t.Fatal("fresh token not accepted")
	}
	now = now.Add(2 * time.Hour)
	if _, ok := store.Authenticate(token); ok {
		t.Fatal("expired token accepted")
	}
}

func TestSessionsSurviveRestartAndStoreOnlyHashes(t *testing.T) {
	dir := t.TempDir()
	store, _ := NewAuthStore(dir, time.Hour)
	_ = store.AddUser("alice", RoleAdmin, testPassword)
	token, _, _, err := store.Login("alice", testPassword, "10.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := NewAuthStore(dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := reopened.Authenticate(token); !ok {
		t.Fatal("session lost after restart")
	}
	if _, ok := reopened.sessions[token]; ok {
		t.Fatal("raw token stored")
	}
}

func TestLoginLockout(t *testing.T) {
	store := newTestStore(t)
	_ = store.AddUser("alice", RoleAdmin, testPassword)
	for i := 0; i < maxLoginFailures; i++ {
		if _, _, _, err := store.Login("alice", "wrong-password-1", "10.0.0.1"); err != errInvalidCredentials {
			t.Fatalf("attempt %d: got %v", i, err)
		}
	}
	if _, _, _, err := store.Login("alice", testPassword, "10.0.0.1"); err != errTooManyAttempts {
		t.Fatalf("expected lockout, got %v", err)
	}
	if _, _, _, err := store.Login("alice", testPassword, "10.0.0.2"); err != nil {
		t.Fatalf("other client should not be locked: %v", err)
	}
}

func TestPasswordChangeRevokesSessions(t *testing.T) {
	store := newTestStore(t)
	_ = store.AddUser("alice", RoleAdmin, testPassword)
	token, _, _, _ := store.Login("alice", testPassword, "10.0.0.1")
	if err := store.SetPassword("alice", "another-long-password"); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Authenticate(token); ok {
		t.Fatal("session survived password change")
	}
}

func TestRoleEnforcementAndAudit(t *testing.T) {
	store := newTestStore(t)
	_ = store.AddUser("view", RoleViewer, testPassword)
	_ = store.AddUser("op", RoleOperator, testPassword)
	_ = store.AddUser("root", RoleAdmin, testPassword)
	audit := NewAuditLog(t.TempDir())
	server := httptest.NewServer(withAudit(audit, (&API{}).routes(store, audit)))
	defer server.Close()

	login := func(user string) string {
		t.Helper()
		resp, err := http.Post(server.URL+"/api/v1/auth/login", "application/json",
			strings.NewReader(`{"username":"`+user+`","password":"`+testPassword+`"}`))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("login %s: %d", user, resp.StatusCode)
		}
		var out loginResponse
		if err := decodeJSON(resp.Body, &out); err != nil {
			t.Fatal(err)
		}
		return out.Token
	}
	status := func(method, path, token string) int {
		t.Helper()
		req, _ := http.NewRequest(method, server.URL+path, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	viewer, operator, admin := login("view"), login("op"), login("root")

	cases := []struct {
		name         string
		method, path string
		token        string
		want         int
	}{
		{"no token", "GET", "/api/v1/audit", "", 401},
		{"bad token", "GET", "/api/v1/audit", "nope", 401},
		{"viewer reads audit", "GET", "/api/v1/audit", viewer, 403},
		{"operator reads audit", "GET", "/api/v1/audit", operator, 403},
		{"admin reads audit", "GET", "/api/v1/audit", admin, 200},
		{"viewer cannot run terminal", "POST", "/api/v1/terminal/exec", viewer, 403},
		{"operator cannot run terminal", "POST", "/api/v1/terminal/exec", operator, 403},
		{"viewer cannot restart", "POST", "/api/v1/containers/abcdef123456/restart", viewer, 403},
		{"viewer cannot read logs", "GET", "/api/v1/logs", viewer, 403},
		{"anonymous cannot list containers", "GET", "/api/v1/containers", "", 401},
		{"me works", "GET", "/api/v1/auth/me", viewer, 200},
	}
	for _, tc := range cases {
		if got := status(tc.method, tc.path, tc.token); got != tc.want {
			t.Errorf("%s: got %d, want %d", tc.name, got, tc.want)
		}
	}

	entries, err := audit.Tail(50)
	if err != nil {
		t.Fatal(err)
	}
	var sawDenied, sawLogin bool
	for _, e := range entries {
		if e.Path == "/api/v1/terminal/exec" && e.Status == 403 && e.User == "op" {
			sawDenied = true
		}
		if e.Detail == "login" && e.User == "root" && e.Status == 200 {
			sawLogin = true
		}
	}
	if !sawDenied || !sawLogin {
		t.Errorf("audit log missing entries (denied=%v login=%v): %+v", sawDenied, sawLogin, entries)
	}

	if got := status("POST", "/api/v1/auth/logout", admin); got != 200 {
		t.Fatalf("logout: %d", got)
	}
	if got := status("GET", "/api/v1/auth/me", admin); got != 401 {
		t.Fatalf("token still valid after logout: %d", got)
	}
}

func decodeJSON(r interface{ Read([]byte) (int, error) }, dst any) error {
	return json.NewDecoder(r).Decode(dst)
}
