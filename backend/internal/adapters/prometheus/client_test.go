package prometheus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	obs "github.com/ppdev28/CoreOps/backend/internal/observability"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestQueryFiniteGapsLimitsAndCache(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer private" {
			t.Error("missing backend source authentication")
		}
		switch r.URL.Query().Get("query") {
		case "many":
			rows := make([]map[string]any, 51)
			for i := range rows {
				rows[i] = map[string]any{"metric": map[string]string{}, "values": [][2]any{{100, "1"}}}
			}
			json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": "matrix", "result": rows}})
		case "broken":
			fmt.Fprint(w, `{"status":"error","error":"sensitive details"}`)
		case "empty":
			fmt.Fprint(w, `{"status":"success","data":{"resultType":"vector","result":[]}}`)
		default:
			if r.URL.Path != "/api/v1/query_range" || r.URL.Query().Get("start") != "100" || r.URL.Query().Get("step") != "15" {
				t.Error("invalid range mapping")
			}
			fmt.Fprint(w, `{"status":"success","warnings":["partial response"],"data":{"resultType":"matrix","result":[{"metric":{"instance":"host","credential":"must not leak"},"values":[[100,"0"],[115,"NaN"],[130,"+Inf"],[145,"-Inf"],[160,"12.5"]]}]}}`)
		}
	}))
	defer s.Close()
	c, e := New(Config{PrometheusURL: s.URL, PrometheusToken: "private"})
	if e != nil {
		t.Fatal(e)
	}
	window := &obs.Window{From: 100, To: 160, Step: 15}
	for range 2 {
		q, e := c.Query(context.Background(), "valid", window)
		if e != nil {
			t.Fatal(e)
		}
		p := q.Series[0].Points
		if len(p) != 5 || p[0].Value == nil || *p[0].Value != 0 || p[1].Value != nil || p[2].Value != nil || p[3].Value != nil || *p[4].Value != 12.5 || p[4].Time != 160000 {
			t.Fatalf("invalid values: %+v", p)
		}
		if _, ok := q.Series[0].Labels["credential"]; ok {
			t.Fatal("unknown labels exposed")
		}
		if len(q.Warnings) != 1 {
			t.Fatal("missing warning")
		}
	}
	if calls.Load() != 1 {
		t.Fatal("short cache not used")
	}
	if _, e = c.Query(context.Background(), "many", window); !errors.Is(e, obs.ErrLimit) {
		t.Fatal("series limit missing", e)
	}
	if _, e = c.Query(context.Background(), "broken", window); e == nil || strings.Contains(e.Error(), "sensitive") {
		t.Fatal("unsafe/absent error", e)
	}
	q, e := c.Query(context.Background(), "empty", nil)
	if e != nil || len(q.Series) != 0 {
		t.Fatal("empty response not distinguished", q, e)
	}
}
func TestSourcesAreIndependentAndNeverForwardRedirects(t *testing.T) {
	var leaked atomic.Int32
	dst := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked.Add(1) }))
	defer dst.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			fmt.Fprint(w, `{"database":"ok","version":"test"}`)
			return
		}
		http.Redirect(w, r, dst.URL, 302)
	}))
	defer source.Close()
	c, _ := New(Config{PrometheusURL: source.URL, GrafanaURL: source.URL, PrometheusToken: "never-forward"})
	p, g := c.Status(context.Background())
	if p.Healthy || !g.Healthy || leaked.Load() != 0 || strings.Contains(p.Error, "never-forward") {
		t.Fatal(p, g, leaked.Load())
	}
	for _, url := range []string{"file:///tmp/x", "http://user:secret@localhost", "https://localhost?token=secret", "http://localhost/#fragment"} {
		if _, e := New(Config{PrometheusURL: url}); e == nil {
			t.Errorf("accepted %s", url)
		}
	}
}
func TestSourcePermissionsCancellationAndRules(t *testing.T) {
	mode := "deny"
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch mode {
		case "deny":
			w.WriteHeader(403)
			fmt.Fprint(w, "secret detail")
		case "cancel":
			<-r.Context().Done()
		case "rules":
			fmt.Fprint(w, `{"status":"success","data":{"groups":[{"rules":[{"type":"alerting","name":"TargetDown","state":"firing","query":"up == 0","duration":120,"labels":{"severity":"critical"},"health":"ok","alerts":[{"state":"firing","activeAt":"2026-11-16T09:00:00Z","value":"0","labels":{"job":"coreops-host","instance":"host:9100"},"annotations":{"description":"Scrape failed","check":"Check exporter"}}]}]}]}}`)
		}
	}))
	defer s.Close()
	c, _ := New(Config{PrometheusURL: s.URL})
	if _, e := c.Query(context.Background(), "up", nil); !errors.Is(e, obs.ErrUnavailable) || !strings.Contains(e.Error(), "permissions") || strings.Contains(e.Error(), "secret") {
		t.Fatal(e)
	}
	mode = "rules"
	rules, e := c.Rules(context.Background())
	if e != nil || len(rules) != 1 || rules[0].Alerts[0].Duration != 120 || rules[0].Alerts[0].Labels["instance"] != "host:9100" {
		t.Fatal(rules, e)
	}
	mode = "cancel"
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, e = c.Query(ctx, "another", nil)
	if e == nil || time.Since(start) > time.Second {
		t.Fatal("cancel not propagated", e)
	}
}
