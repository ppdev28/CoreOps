package main

import (
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestIdentityChangesAcrossProcesses(t *testing.T) {
	server := newTestStore(t)
	cli, err := NewAuthStore(server.dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if err := cli.AddUser("alice", RoleAdmin, testPassword); err != nil {
		t.Fatal(err)
	}
	token, _, _, err := server.Login("alice", testPassword, "local")
	if err != nil {
		t.Fatal(err)
	}
	if err := cli.SetPassword("alice", "replacement-password"); err != nil {
		t.Fatal(err)
	}
	if _, ok := server.Authenticate(token); ok {
		t.Fatal("CLI password change did not revoke live session")
	}
	if _, _, _, err := server.Login("alice", testPassword, "local"); err != errInvalidCredentials {
		t.Fatal("old password accepted", err)
	}
	token, _, _, err = server.Login("alice", "replacement-password", "local")
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(os.Args[0], "-test.run=^TestIdentityCLIProcess$")
	command.Env = append(os.Environ(), "COREOPS_TEST_IDENTITY_DIR="+server.dir)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("CLI process: %v %s", err, output)
	}
	if _, ok := server.Authenticate(token); ok {
		t.Fatal("external removal did not revoke session")
	}
	// A later login/save must not resurrect the externally removed account.
	if err := server.AddUser("bob", RoleViewer, testPassword); err != nil {
		t.Fatal(err)
	}
	users, err := cli.ListUsers()
	if err != nil || len(users) != 1 || users[0].Name != "bob" {
		t.Fatalf("stale state overwritten: %v %v", users, err)
	}
}

func TestIdentityCLIProcess(t *testing.T) {
	dir := os.Getenv("COREOPS_TEST_IDENTITY_DIR")
	if dir == "" {
		return
	}
	t.Setenv("COREOPS_DATA_DIR", dir)
	if code := runUserCLI([]string{"remove", "alice"}); code != 0 {
		t.Fatalf("CLI exit status: %d", code)
	}
}

func TestIdentityConcurrentLoginAndPasswordChange(t *testing.T) {
	server := newTestStore(t)
	if err := server.AddUser("alice", RoleAdmin, testPassword); err != nil {
		t.Fatal(err)
	}
	cli, err := NewAuthStore(server.dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	var token string
	var loginErr, changeErr error
	var group sync.WaitGroup
	group.Add(2)
	go func() { defer group.Done(); token, _, _, loginErr = server.Login("alice", testPassword, "local") }()
	go func() { defer group.Done(); changeErr = cli.SetPassword("alice", "replacement-password") }()
	group.Wait()
	if changeErr != nil {
		t.Fatal(changeErr)
	}
	if loginErr != nil && loginErr != errInvalidCredentials {
		t.Fatal(loginErr)
	}
	if _, ok := server.Authenticate(token); ok {
		t.Fatal("concurrent old-password login survived revocation")
	}
}

func TestIdentityConcurrentStoresKeepBothSessions(t *testing.T) {
	first := newTestStore(t)
	if err := first.AddUser("alice", RoleAdmin, testPassword); err != nil {
		t.Fatal(err)
	}
	second, err := NewAuthStore(first.dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	stores := []*AuthStore{first, second}
	tokens := make([]string, 2)
	errors := make([]error, 2)
	var group sync.WaitGroup
	for index, store := range stores {
		group.Add(1)
		go func(index int, store *AuthStore) {
			defer group.Done()
			tokens[index], _, _, errors[index] = store.Login("alice", testPassword, "local")
		}(index, store)
	}
	group.Wait()
	for index, token := range tokens {
		if errors[index] != nil {
			t.Fatal(errors[index])
		}
		if _, ok := first.Authenticate(token); !ok {
			t.Fatal("concurrent session was overwritten")
		}
	}
}

func TestIdentityStorageFailuresFailClosed(t *testing.T) {
	store := newTestStore(t)
	if err := store.AddUser("alice", RoleAdmin, testPassword); err != nil {
		t.Fatal(err)
	}
	token, _, _, err := store.Login("alice", testPassword, "local")
	if err != nil {
		t.Fatal(err)
	}
	if os.Geteuid() != 0 {
		if err := os.Chmod(store.dir, 0500); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(store.dir, 0700) })
		r := httptest.NewRequest("POST", "/api/v1/auth/logout", nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		store.logoutHandler(w, r)
		if w.Code != 503 {
			t.Fatalf("failed logout reported success: %d", w.Code)
		}
		if newToken, _, _, err := store.Login("alice", testPassword, "local"); err == nil || newToken != "" {
			t.Fatal("failed session write reported success")
		}
		if err := store.SetPassword("alice", "replacement-password"); err == nil {
			t.Fatal("failed password write reported success")
		}
		if err := os.Chmod(store.dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(store.dir, usersFileName), []byte("invalid-json"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Authenticate(token); ok {
		t.Fatal("corrupt state accepted cached admin session")
	}
	if _, err := NewAuthStore(store.dir, time.Hour); err == nil {
		t.Fatal("corrupt state accepted on restart")
	}
}
