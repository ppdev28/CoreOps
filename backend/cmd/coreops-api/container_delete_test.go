package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/client"
)

func deleteHarness(t *testing.T, engineStatus int) (http.Handler, *AuthStore, *AuditLog, *atomic.Int32) {
	t.Helper()
	calls := &atomic.Int32{}
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodDelete || r.URL.Path != "/v1.52/containers/"+createdContainerID {
			t.Errorf("unexpected Docker operation: %s %s", r.Method, r.URL.Path)
		}
		if r.URL.RawQuery != "" {
			t.Errorf("unsafe deletion options: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(engineStatus)
		if engineStatus != 204 {
			_, _ = w.Write([]byte(`{"message":"upstream-sensitive-details"}`))
		}
	}))
	t.Cleanup(engine.Close)
	docker, err := client.NewClientWithOpts(client.WithHost("tcp://"+engine.Listener.Addr().String()), client.WithVersion("1.52"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = docker.Close() })
	store := newTestStore(t)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleAdmin} {
		store.users[string(role)] = User{Name: string(role), Role: role}
		store.sessions[tokenKey(string(role))] = session{User: string(role), Expires: time.Now().Add(time.Hour)}
	}
	if err := store.save(usersFileName, store.users); err != nil {
		t.Fatal(err)
	}
	if err := store.save(sessionsFileName, store.sessions); err != nil {
		t.Fatal(err)
	}
	audit := NewAuditLog(store.dir)
	api := &API{docker: docker}
	handler := withCORS(withAudit(audit, api.routes(store, audit)))
	t.Cleanup(api.terminals.Close)
	return handler, store, audit, calls
}

func removeRequest(handler http.Handler, token, target, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodDelete, target, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestDeleteContainerAuthorizationAndRevocation(t *testing.T) {
	handler, store, audit, calls := deleteHarness(t, 204)
	for token, expected := range map[string]int{"": 401, "viewer": 403, "operator": 403} {
		response := removeRequest(handler, token, "/api/v1/containers/"+createdContainerID, "")
		if response.Code != expected {
			t.Fatalf("token %q: %d", token, response.Code)
		}
	}
	cli, err := NewAuthStore(store.dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if err := cli.RemoveUser("admin"); err != nil {
		t.Fatal(err)
	}
	if response := removeRequest(handler, "admin", "/api/v1/containers/"+createdContainerID, ""); response.Code != 401 {
		t.Fatal("revoked session can delete")
	}
	if calls.Load() != 0 {
		t.Fatal("unauthorized request reached Docker")
	}
	rows, err := audit.Tail(10)
	if err != nil || len(rows) != 4 {
		t.Fatalf("missing denial audit: %v %v", rows, err)
	}
}

func TestDeleteContainerValidationAndSafeOptions(t *testing.T) {
	handler, _, audit, calls := deleteHarness(t, 204)
	for _, target := range []string{
		"/api/v1/containers/nginx", "/api/v1/containers/1234", "/api/v1/containers/abcdefZZZZZZ",
		"/api/v1/containers/" + createdContainerID + "?force=true",
		"/api/v1/containers/" + createdContainerID + "?v=1",
	} {
		if response := removeRequest(handler, "admin", target, ""); response.Code != 400 {
			t.Errorf("%s: %d", target, response.Code)
		}
	}
	if response := removeRequest(handler, "admin", "/api/v1/containers/"+createdContainerID, `{"force":true}`); response.Code != 400 {
		t.Fatal("accepted deletion body")
	}
	if calls.Load() != 0 {
		t.Fatal("invalid request reached Docker")
	}
	response := removeRequest(handler, "admin", "/api/v1/containers/"+createdContainerID, "")
	if response.Code != 200 {
		t.Fatalf("%d %s", response.Code, response.Body.String())
	}
	var body struct {
		OK bool   `json:"ok"`
		ID string `json:"id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.ID != createdContainerID || calls.Load() != 1 {
		t.Fatal("deletion not confirmed", body, calls.Load())
	}
	rows, err := audit.Tail(1)
	if err != nil || len(rows) != 1 || rows[0].Method != "DELETE" || rows[0].Status != 200 || rows[0].User != "admin" || !strings.Contains(rows[0].Detail, "preserve volumes; no force") {
		t.Fatalf("missing deletion audit: %v %v", rows, err)
	}
}

func TestDeleteContainerFailureDoesNotReportSuccess(t *testing.T) {
	for engineStatus, expected := range map[int]int{404: 404, 409: 409, 400: 400, 500: 502} {
		t.Run(http.StatusText(engineStatus), func(t *testing.T) {
			handler, _, _, calls := deleteHarness(t, engineStatus)
			response := removeRequest(handler, "admin", "/api/v1/containers/"+createdContainerID, "")
			if response.Code != expected || calls.Load() != 1 {
				t.Fatalf("%d %s; calls=%d", response.Code, response.Body.String(), calls.Load())
			}
			if strings.Contains(response.Body.String(), "upstream-sensitive") || strings.Contains(response.Body.String(), `"ok":true`) {
				t.Fatal("engine failure was leaked or reported as success")
			}
			if engineStatus == 409 && !strings.Contains(response.Body.String(), "Stop it") {
				t.Fatal("conflict has no actionable stop instruction")
			}
		})
	}
}

func TestDeleteContainerPreflight(t *testing.T) {
	handler, _, _, calls := deleteHarness(t, 204)
	r := httptest.NewRequest(http.MethodOptions, "/api/v1/containers/"+createdContainerID, nil)
	r.Header.Set("Origin", "http://localhost:5173")
	r.Header.Set("Access-Control-Request-Method", "DELETE")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 204 || !strings.Contains(w.Header().Get("Access-Control-Allow-Methods"), "DELETE") || w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatal("DELETE preflight unavailable", w.Code, w.Header())
	}
	if calls.Load() != 0 {
		t.Fatal("preflight invoked Docker")
	}
}
