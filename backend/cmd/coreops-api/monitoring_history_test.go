package main

import (
	"context"
	"github.com/ppdev28/CoreOps/backend/internal/monitoring"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type historyFixture struct{ calls int }

func (h *historyFixture) Read(ctx context.Context, from, to time.Time) (monitoring.Archive, error) {
	h.calls++
	v := 20.0
	return monitoring.Archive{Samples: []monitoring.HistoryPoint{{Time: to.Add(-2 * time.Hour).UnixMilli(), CPU: &v, IntervalMS: 600000}}}, nil
}
func TestHistoryRouteRolesAndRangeValidation(t *testing.T) {
	auth := newTestStore(t)
	auth.users["viewer"] = User{Name: "viewer", Role: RoleViewer}
	auth.sessions[tokenKey("viewer")] = session{User: "viewer", Expires: time.Now().Add(time.Hour)}
	if e := auth.save(usersFileName, auth.users); e != nil {
		t.Fatal(e)
	}
	if e := auth.save(sessionsFileName, auth.sessions); e != nil {
		t.Fatal(e)
	}
	fixture := &historyFixture{}
	api := &API{history: monitoring.NewHistory(fixture)}
	audit := NewAuditLog(auth.dir)
	handler := api.routes(auth, audit)
	defer api.terminals.Close()
	for _, tc := range []struct {
		token, query string
		status       int
	}{{"", "24h", 401}, {"viewer", "bad", 400}, {"viewer", "24h", 200}} {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/monitoring/history?range="+tc.query, nil)
		if tc.token != "" {
			req.Header.Set("Authorization", "Bearer "+tc.token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.query, w.Code, w.Body.String())
		}
		if tc.status == 200 && (!strings.Contains(w.Body.String(), `"source":"sysstat"`) || w.Header().Get("Cache-Control") != "no-store") {
			t.Fatal("invalid history contract")
		}
	}
	if fixture.calls != 1 {
		t.Fatal("unauthorized/invalid request reached history source")
	}
}
