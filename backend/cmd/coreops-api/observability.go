package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	promadapter "github.com/ppdev28/CoreOps/backend/internal/adapters/prometheus"
	obs "github.com/ppdev28/CoreOps/backend/internal/observability"
)

func obsToken(name string) (string, error) {
	value := envString(name, "")
	if file := envString(name+"_FILE", ""); file != "" {
		f, e := os.Open(file)
		if e != nil {
			return "", fmt.Errorf("cannot read %s_FILE", name)
		}
		defer f.Close()
		b, e := io.ReadAll(io.LimitReader(f, 8193))
		if e != nil || len(b) > 8192 {
			return "", fmt.Errorf("invalid %s_FILE", name)
		}
		value = strings.TrimSpace(string(b))
	}
	if strings.ContainsAny(value, "\r\n") {
		return "", fmt.Errorf("invalid %s", name)
	}
	return value, nil
}
func newObservability() (*obs.Service, string, error) {
	token, e := obsToken("COREOPS_METRICS_TOKEN")
	if e != nil {
		return nil, "", e
	}
	if token != "" && len(token) < 24 {
		return nil, "", errors.New("COREOPS_METRICS_TOKEN must contain at least 24 characters")
	}
	promToken, e := obsToken("COREOPS_PROMETHEUS_TOKEN")
	if e != nil {
		return nil, "", e
	}
	grafanaToken, e := obsToken("COREOPS_GRAFANA_TOKEN")
	if e != nil {
		return nil, "", e
	}
	cfg := obs.Config{PrometheusURL: envString("COREOPS_PROMETHEUS_URL", ""), GrafanaURL: envString("COREOPS_GRAFANA_URL", ""), GrafanaPublicURL: envString("COREOPS_GRAFANA_PUBLIC_URL", ""), NodeJob: envString("COREOPS_PROMETHEUS_NODE_JOB", "coreops-host"), APIJob: envString("COREOPS_PROMETHEUS_API_JOB", "coreops-api"), HostDashboard: "coreops-host", APIDashboard: "coreops-backend"}
	source, e := promadapter.New(promadapter.Config{PrometheusURL: cfg.PrometheusURL, GrafanaURL: cfg.GrafanaURL, GrafanaPublicURL: cfg.GrafanaPublicURL, PrometheusToken: promToken, GrafanaToken: grafanaToken, CAFile: envString("COREOPS_OBSERVABILITY_CA_FILE", ""), NodeJob: cfg.NodeJob, APIJob: cfg.APIJob})
	if e != nil {
		return nil, "", e
	}
	return obs.New(source, cfg), token, nil
}
func obsFilter(r *http.Request) obs.Filter {
	return obs.Filter{Resource: r.URL.Query().Get("resource"), Job: r.URL.Query().Get("job"), Instance: r.URL.Query().Get("instance")}
}
func obsWindow(r *http.Request) (obs.Window, error) {
	q := r.URL.Query()
	from, e1 := strconv.ParseInt(q.Get("from"), 10, 64)
	to, e2 := strconv.ParseInt(q.Get("to"), 10, 64)
	step, e3 := strconv.ParseInt(q.Get("step"), 10, 64)
	w := obs.Window{From: from, To: to, Step: step}
	if e1 != nil || e2 != nil || e3 != nil {
		return w, obs.ErrFilter
	}
	return w, w.Validate(time.Now())
}
func obsError(w http.ResponseWriter, e error) {
	status := 503
	if errors.Is(e, obs.ErrFilter) || errors.Is(e, obs.ErrLimit) {
		status = 400
	}
	if errors.Is(e, obs.ErrNotFound) {
		status = 404
	}
	writeError(w, status, e)
}
func obsBounded(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		next(w, r.WithContext(ctx))
	}
}
func (a *API) obsIntegrations(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, a.observability.Integrations(r.Context()))
}
func (a *API) obsSummary(w http.ResponseWriter, r *http.Request) {
	var at []int64
	if r.URL.Query().Has("from") {
		window, e := obsWindow(r)
		if e != nil {
			obsError(w, e)
			return
		}
		at = append(at, window.To)
	}
	data, e := a.observability.Overview(r.Context(), obsFilter(r), at...)
	if e != nil {
		obsError(w, e)
		return
	}
	writeJSON(w, 200, data)
}
func (a *API) obsTargets(w http.ResponseWriter, r *http.Request) {
	data, e := a.observability.Targets(r.Context(), obsFilter(r))
	if e != nil {
		obsError(w, e)
		return
	}
	writeJSON(w, 200, data)
}
func (a *API) obsRules(w http.ResponseWriter, r *http.Request) {
	rules, alerts, e := a.observability.Rules(r.Context(), obsFilter(r))
	if e != nil {
		obsError(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"rules": rules, "alerts": alerts})
}
func (a *API) obsSeries(w http.ResponseWriter, r *http.Request) {
	window, e := obsWindow(r)
	if e != nil {
		obsError(w, e)
		return
	}
	ids := strings.Split(r.URL.Query().Get("metrics"), ",")
	data, e := a.observability.Charts(r.Context(), obsFilter(r), window, ids)
	if e != nil {
		obsError(w, e)
		return
	}
	writeJSON(w, 200, data)
}
func (a *API) obsResource(w http.ResponseWriter, r *http.Request) {
	window, e := obsWindow(r)
	if e != nil {
		obsError(w, e)
		return
	}
	resource, alerts, charts, e := a.observability.Resource(r.Context(), r.PathValue("id"), window)
	if e != nil {
		obsError(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"resource": resource, "alerts": alerts, "charts": charts})
}
func (a *API) obsGrafana(w http.ResponseWriter, r *http.Request) {
	window, e := obsWindow(r)
	if e != nil {
		obsError(w, e)
		return
	}
	link, e := a.observability.GrafanaLink(r.URL.Query().Get("kind"), obsFilter(r), window)
	if e != nil {
		obsError(w, e)
		return
	}
	writeJSON(w, 200, map[string]string{"url": link})
}
