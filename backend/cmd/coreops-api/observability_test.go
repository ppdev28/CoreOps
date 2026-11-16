package main

import (
	"github.com/ppdev28/CoreOps/backend/internal/telemetry"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestObservabilityRoutesRequireExistingSessionAndPreserveSourceErrors(t *testing.T) {
	var calls atomic.Int32
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(403) }))
	defer source.Close()
	t.Setenv("COREOPS_PROMETHEUS_URL", source.URL)
	t.Setenv("COREOPS_GRAFANA_URL", "")
	t.Setenv("COREOPS_METRICS_TOKEN", strings.Repeat("x", 32))
	auth := newTestStore(t)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleAdmin, "denied"} {
		auth.users[string(role)] = User{Name: string(role), Role: role}
		auth.sessions[tokenKey(string(role))] = session{User: string(role), Expires: time.Now().Add(time.Hour)}
	}
	auth.sessions[tokenKey("expired")] = session{User: "viewer", Expires: time.Now().Add(-time.Second)}
	if e := auth.save(usersFileName, auth.users); e != nil {
		t.Fatal(e)
	}
	if e := auth.save(sessionsFileName, auth.sessions); e != nil {
		t.Fatal(e)
	}
	api := &API{telemetry: telemetry.New(strings.Repeat("x", 32))}
	handler := api.routes(auth, NewAuditLog(auth.dir))
	defer api.terminals.Close()
	paths := []string{"/summary", "/targets", "/rules", "/series", "/resources/example", "/grafana-link", "/integrations"}
	for _, path := range paths {
		r := httptest.NewRequest("GET", "/api/v1/observability"+path, nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Errorf("%s not protected: %d", path, w.Code)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("anonymous requests reached source")
	}
	for _, tc := range []struct {
		token, path string
		status      int
	}{{"expired", "/summary", 401}, {"denied", "/summary", 403}, {"viewer", "/summary", 503}, {"operator", "/targets", 503}, {"admin", "/rules", 503}, {"viewer", "/integrations", 200}, {"viewer", "/series?from=1&to=2&step=15&metrics=up", 400}, {"viewer", "/summary?resource=invalid", 400}} {
		r := httptest.NewRequest("GET", "/api/v1/observability"+tc.path, nil)
		r.Header.Set("Authorization", "Bearer "+tc.token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Errorf("%s %s: %d %s", tc.token, tc.path, w.Code, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != "no-store" && tc.status != 401 && tc.status != 403 {
			t.Error("missing no-store")
		}
	}
	for _, tc := range []struct {
		token  string
		status int
	}{{"viewer", 401}, {strings.Repeat("x", 32), 200}} {
		r := httptest.NewRequest("GET", "/metrics", nil)
		r.Header.Set("Authorization", "Bearer "+tc.token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatal("scrape identity not separate", w.Code)
		}
	}
}
