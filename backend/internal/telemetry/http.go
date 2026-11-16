// Package telemetry instruments bounded HTTP dimensions without depending on
// product handlers or authentication. Each API instance owns its own registry.
package telemetry

import (
	"bufio"
	"crypto/subtle"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/felixge/httpsnoop"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type HTTP struct {
	registry *prometheus.Registry
	requests *prometheus.CounterVec
	duration *prometheus.HistogramVec
	inflight *prometheus.GaugeVec
	token    string
}

func New(token string) *HTTP {
	h := &HTTP{registry: prometheus.NewRegistry(), token: token}
	labels := []string{"method", "route", "code", "transport"}
	h.requests = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "coreops_http_requests_total", Help: "Completed HTTP requests; scraping is excluded. Routes are normalized ServeMux patterns."}, labels)
	h.duration = prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "coreops_http_request_duration_seconds", Help: "HTTP handler duration; websocket lifetime is differentiated by transport.", Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10, 30}}, labels)
	h.inflight = prometheus.NewGaugeVec(prometheus.GaugeOpts{Name: "coreops_http_requests_in_flight", Help: "Current requests separated into HTTP and websocket transports; scrapes excluded."}, []string{"transport"})
	h.registry.MustRegister(h.requests, h.duration, h.inflight, collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	return h
}
func method(raw string) string {
	switch raw {
	case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE":
		return raw
	default:
		return "OTHER"
	}
}
func (h *HTTP) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		transport := "http"
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			transport = "websocket"
		}
		h.inflight.WithLabelValues(transport).Inc()
		defer h.inflight.WithLabelValues(transport).Dec()
		started := time.Now()
		status := 500
		defer func() {
			route := r.Pattern
			if _, path, ok := strings.Cut(route, " "); ok {
				route = path
			}
			if route == "" {
				route = "unmatched"
			}
			h.requests.WithLabelValues(method(r.Method), route, strconv.Itoa(status), transport).Inc()
			h.duration.WithLabelValues(method(r.Method), route, strconv.Itoa(status), transport).Observe(time.Since(started).Seconds())
		}()
		// httpsnoop preserves optional interfaces, including Hijacker for PTY and
		// Flusher/ReaderFrom for streamed transfers. Do not replace with a plain wrapper.
		hijacked := false
		wrapped := httpsnoop.Wrap(w, httpsnoop.Hooks{Hijack: func(next httpsnoop.HijackFunc) httpsnoop.HijackFunc {
			return func() (net.Conn, *bufio.ReadWriter, error) {
				conn, rw, err := next()
				if err == nil {
					hijacked = true
				}
				return conn, rw, err
			}
		}})
		metrics := httpsnoop.CaptureMetrics(next, wrapped, r)
		status = metrics.Code
		if hijacked && transport == "websocket" {
			status = http.StatusSwitchingProtocols
		}
	})
}
func (h *HTTP) Metrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if h.token == "" {
		http.Error(w, "metrics scraping is not configured", http.StatusServiceUnavailable)
		return
	}
	supplied := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || len(supplied) != len(h.token) || subtle.ConstantTimeCompare([]byte(supplied), []byte(h.token)) != 1 {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "metrics authentication required", http.StatusUnauthorized)
		return
	}
	promhttp.HandlerFor(h.registry, promhttp.HandlerOpts{MaxRequestsInFlight: 2, Timeout: 5 * time.Second}).ServeHTTP(w, r)
}
