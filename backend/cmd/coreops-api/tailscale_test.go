package main

import (
	"context"
	"encoding/json"
	core "github.com/ppdev28/CoreOps/backend/internal/tailscale"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type tailscaleFixture struct {
	s             core.Snapshot
	reads, writes int
	inspect       func()
}

func (f *tailscaleFixture) Inspect(context.Context) (core.Snapshot, error) {
	f.reads++
	if f.inspect != nil {
		f.inspect()
	}
	return f.s, nil
}
func (f *tailscaleFixture) Apply(context.Context, string, core.Changes, string) error {
	f.writes++
	return nil
}
func tsFixture() *tailscaleFixture {
	yes, no := true, false
	hostname := ""
	s := core.Snapshot{Available: true, State: "Running", Hostname: "owned-host", BootID: "boot-test", NodeID: "node-test", Permission: core.Permission{Available: true, Mode: "direct"}, Preferences: &core.Preferences{Hostname: &hostname, WantRunning: &yes, AcceptDNS: &yes, AcceptRoutes: &no, SSH: &yes, ShieldsUp: &no}, IPs: []string{}, Peers: []core.Peer{}, Health: []string{}}
	s.Revision = core.Revision(s, "")
	return &tailscaleFixture{s: s}
}
func tsBody(f *tailscaleFixture) string {
	data, _ := json.Marshal(core.Request{Action: "disconnect", Hostname: f.s.Hostname, Revision: f.s.Revision, RequestID: strings.Repeat("a", 32), Changes: core.Changes{}})
	return string(data)
}
func TestTailscaleHTTPRolesConfirmationsAuditAndReplay(t *testing.T) {
	auth, audit := adminFixture(t)
	f := tsFixture()
	api := &API{tailscale: core.New(f)}
	handler := withAudit(audit, api.routes(auth, audit))
	defer api.terminals.Close()
	for _, tc := range []struct {
		actor     string
		get, post int
	}{{"", 401, 401}, {"viewer", 403, 403}, {"operator", 403, 403}, {"admin", 200, 202}} {
		w := adminRequest(handler, "GET", "/api/v1/tailscale", tc.actor, "")
		if w.Code != tc.get {
			t.Fatal(tc.actor, w.Code, w.Body.String())
		}
		if tc.actor == "admin" && w.Header().Get("Cache-Control") != "no-store, private" {
			t.Fatal("sensitive status cached")
		}
		w = adminRequest(handler, "POST", "/api/v1/tailscale", tc.actor, tsBody(f))
		if w.Code != tc.post {
			t.Fatal(tc.actor, w.Code, w.Body.String())
		}
	}
	if f.writes != 1 {
		t.Fatal("unauthorized daemon changes", f.writes)
	}
	if w := adminRequest(handler, "POST", "/api/v1/tailscale", "admin", tsBody(f)); w.Code != 202 || f.writes != 1 {
		t.Fatal("replay executed twice", w.Code)
	}
	for _, body := range []string{"{}", tsBody(f) + "{}", strings.Replace(tsBody(f), `"changes":{}`, `"changes":{"operator":"attacker"}`, 1)} {
		if w := adminRequest(handler, "POST", "/api/v1/tailscale", "admin", body); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	data, e := os.ReadFile(audit.path)
	if e != nil || !strings.Contains(string(data), "Tailscale dispatch requested action=disconnect") || !strings.Contains(string(data), `"status":202`) {
		t.Fatal("missing intent/result audit", e)
	}
}
func TestTailscaleHTTPRejectsChangedStateRevocationAndAuditFailure(t *testing.T) {
	for _, kind := range []string{"changed", "permission", "revoked", "audit"} {
		t.Run(kind, func(t *testing.T) {
			auth, audit := adminFixture(t)
			f := tsFixture()
			body := tsBody(f)
			want := 409
			switch kind {
			case "changed":
				f.s.Revision = strings.Repeat("f", 64)
			case "permission":
				f.s.Permission.Available = false
				want = 403
			case "revoked":
				f.inspect = func() { auth.Logout("admin") }
				want = 403
			case "audit":
				audit.path = filepath.Join(t.TempDir(), "absent", "audit.log")
				want = 503
			}
			api := &API{tailscale: core.New(f)}
			h := withAudit(audit, api.routes(auth, audit))
			defer api.terminals.Close()
			w := adminRequest(h, "POST", "/api/v1/tailscale", "admin", body)
			if w.Code != want || f.writes != 0 {
				t.Fatal(kind, w.Code, f.writes, w.Body.String())
			}
		})
	}
}
func TestTailscaleHTTPUnknownFieldsAndQueriesDoNotReachDaemon(t *testing.T) {
	auth, audit := adminFixture(t)
	f := tsFixture()
	api := &API{tailscale: core.New(f)}
	h := api.routes(auth, audit)
	defer api.terminals.Close()
	for _, target := range []string{"/api/v1/tailscale?command=logout", "/api/v1/tailscale"} {
		body := strings.Replace(tsBody(f), `"action":"disconnect"`, `"action":"disconnect","authKey":"do-not-store"`, 1)
		r := httptest.NewRequest("POST", target, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer admin")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 400 || f.reads != 0 || f.writes != 0 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
