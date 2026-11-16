package telemetry

import (
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPNormalizedAndScrapesExcluded(t *testing.T) {
	h := New(strings.Repeat("x", 32))
	mux := http.NewServeMux()
	mux.HandleFunc("GET /items/{id}", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	mux.HandleFunc("GET /metrics", h.Metrics)
	handler := h.Wrap(mux)
	for _, path := range []string{"/items/secret-id-1", "/items/secret-id-2", "/arbitrary-first", "/arbitrary-second"} {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", path, nil))
	}
	for _, header := range []string{"", "x", strings.Repeat("x", 32), "Bearer wrong", "Bearer " + strings.Repeat("x", 32)} {
		r := httptest.NewRequest("GET", "/metrics", nil)
		r.Header.Set("Authorization", header)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if header == "Bearer "+strings.Repeat("x", 32) {
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			body := w.Body.String()
			for _, want := range []string{`code="204",method="GET",route="/items/{id}",transport="http"} 2`, `code="404",method="GET",route="unmatched",transport="http"} 2`, `coreops_http_request_duration_seconds_bucket`, `coreops_http_requests_in_flight{transport="http"} 0`, `go_goroutines`, `process_resident_memory_bytes`} {
				if !strings.Contains(body, want) {
					t.Errorf("missing %s", want)
				}
			}
			for _, bad := range []string{"secret-id", "arbitrary-", `route="/metrics"`} {
				if strings.Contains(body, bad) {
					t.Errorf("unbounded/scraping label %s", bad)
				}
			}
		} else if w.Code != 401 {
			t.Fatalf("invalid token accepted (%d)", w.Code)
		}
	}
}
func TestHTTPWebSocketPreservesHijackerAndStatus(t *testing.T) {
	h := New("unused")
	mux := http.NewServeMux()
	upgrader := websocket.Upgrader{}
	mux.HandleFunc("GET /terminal/{id}", func(w http.ResponseWriter, r *http.Request) {
		c, e := upgrader.Upgrade(w, r, nil)
		if e != nil {
			return
		}
		defer c.Close()
		_ = c.WriteMessage(websocket.TextMessage, []byte("ready"))
	})
	done := make(chan struct{})
	wrapped := h.Wrap(mux)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { wrapped.ServeHTTP(w, r); close(done) }))
	defer s.Close()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(s.URL, "http")+"/terminal/test", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_, msg, err := c.ReadMessage()
	if err != nil || string(msg) != "ready" {
		t.Fatal(string(msg), err)
	}
	// Closing the server waits for the handler before gathering completed requests.
	<-done
	s.Close()
	families, err := h.registry.Gather()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, f := range families {
		if f.GetName() == "coreops_http_requests_total" {
			for _, m := range f.Metric {
				for _, l := range m.Label {
					if l.GetName() == "code" && l.GetValue() == "101" {
						found = true
					}
				}
			}
		}
	}
	if !found {
		t.Fatal("successful upgrade not recorded as 101")
	}
}
