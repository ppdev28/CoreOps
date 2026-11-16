package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type updateFixture struct {
	calls   atomic.Int32
	release chan struct{}
	denied  bool
	failed  bool
}

func (f *updateFixture) Check(context.Context) error {
	if f.denied {
		return errors.New("restricted helper required")
	}
	return nil
}
func (f *updateFixture) List(context.Context) (UpdatesOverview, error) {
	return UpdatesOverview{Updates: []UpdatePackage{}, UpdatedAt: time.Now().Format(time.RFC3339)}, nil
}
func (f *updateFixture) Run(ctx context.Context, _ string, _ []string) (string, error) {
	f.calls.Add(1)
	select {
	case <-f.release:
	case <-ctx.Done():
		return "", ctx.Err()
	}
	if f.failed {
		return "E: Could not get lock /var/lib/dpkg/lock", errors.New("APT/dpkg is locked")
	}
	return "Packages updated", nil
}
func TestUpdateJobsAuthenticationConcurrencyDisconnectAndAudit(t *testing.T) {
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
	audit := NewAuditLog(auth.dir)
	runner := &updateFixture{release: make(chan struct{})}
	defer close(runner.release)
	api := &API{updateTasks: newUpdateJobs(runner, audit)}
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
	for _, token := range []string{"", "viewer", "operator"} {
		w := request("POST", "/api/v1/updates/apply", token, `{"all":true}`)
		want := 403
		if token == "" {
			want = 401
		}
		if w.Code != want {
			t.Fatal(token, w.Code)
		}
	}
	for _, body := range []string{`{}`, `{"packages":["x;touch /tmp/bad"]}`, `{"all":true,"packages":["openssl"]}`, `{"all":true,"force":true}`, `{"all":true}{}`} {
		if w := request("POST", "/api/v1/updates/apply", "admin", body); w.Code != 400 {
			t.Fatal(body, w.Code)
		}
	}
	r := httptest.NewRequest("POST", "/api/v1/updates/apply", strings.NewReader(`{"packages":["openssl"]}`))
	r.Header.Set("Authorization", "Bearer admin")
	ctx, cancel := context.WithCancel(r.Context())
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r.WithContext(ctx))
	cancel()
	if w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	var job UpdateJob
	json.Unmarshal(w.Body.Bytes(), &job)
	if w := request("POST", "/api/v1/updates/refresh", "admin", ""); w.Code != 409 {
		t.Fatal("duplicate operation accepted", w.Code)
	}
	if w := request("GET", "/api/v1/updates/jobs/current", "viewer", ""); w.Code != 403 {
		t.Fatal(w.Code)
	}
	runner.release <- struct{}{}
	deadline := time.Now().Add(time.Second)
	for {
		w := request("GET", "/api/v1/updates/jobs/"+job.ID, "admin", "")
		json.Unmarshal(w.Body.Bytes(), &job)
		if job.Status == "succeeded" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("job did not complete independently of request cancellation")
		}
		time.Sleep(time.Millisecond)
	}
	if runner.calls.Load() != 1 || job.Output != "Packages updated" {
		t.Fatal(runner.calls.Load(), job)
	}
	// Audit terminal outcomes are emitted after result state is stored.
	for time.Now().Before(deadline) {
		entries, _ := audit.Tail(100)
		for _, e := range entries {
			if e.Method == "JOB" && e.Status == 200 {
				return
			}
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("missing audited terminal job outcome")
}
func TestUpdateJobFailureAndPrivilegeFailure(t *testing.T) {
	runner := &updateFixture{release: make(chan struct{}), failed: true}
	j := newUpdateJobs(runner, nil)
	job, e := j.start("refresh", nil, User{Name: "admin", Role: RoleAdmin})
	if e != nil {
		t.Fatal(e)
	}
	close(runner.release)
	deadline := time.Now().Add(time.Second)
	for {
		j.mu.Lock()
		task := j.jobs[job.ID]
		j.mu.Unlock()
		if task.Status == "failed" {
			if !strings.Contains(task.Output, "lock") || task.Error == "" {
				t.Fatal(task)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("failure not recorded")
		}
		time.Sleep(time.Millisecond)
	}
	denied := newUpdateJobs(&updateFixture{denied: true}, nil)
	if c := denied.capability(context.Background()); c.Available || c.Error == "" {
		t.Fatal(c)
	}
}
func TestPackageCommandEnvironmentOutputBoundsAndNoRetry(t *testing.T) {
	t.Setenv("COREOPS_ADMIN_PASSWORD", "must-not-leak")
	file := filepath.Join(t.TempDir(), "probe")
	if e := os.WriteFile(file, []byte("#!/bin/sh\nprintf '%s|%s|%s' \"${COREOPS_ADMIN_PASSWORD-unset}\" \"$LC_ALL\" \"$DEBIAN_FRONTEND\"\n"), 0700); e != nil {
		t.Fatal(e)
	}
	out, e := runPackageCommand(context.Background(), 1000, file)
	if e != nil || out != "unset|C|noninteractive" {
		t.Fatal(out, e)
	}
	if e := os.WriteFile(file, []byte("#!/bin/sh\nprintf '0123456789abcdefghijkl'\nexit 42\n"), 0700); e != nil {
		t.Fatal(e)
	}
	out, e = runPackageCommand(context.Background(), 10, file)
	if e == nil || !strings.HasSuffix(out, "cdefghijkl") {
		t.Fatal(out, e)
	}
	b := &outputTail{limit: 4}
	b.Write([]byte("123456"))
	if string(b.data) != "3456" || b.total != 6 {
		t.Fatal(b)
	}
}
