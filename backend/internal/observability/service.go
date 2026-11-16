package observability

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

type Config struct {
	PrometheusURL    string
	GrafanaURL       string
	GrafanaPublicURL string
	NodeJob          string
	APIJob           string
	HostDashboard    string
	APIDashboard     string
}
type Service struct {
	source Source
	config Config
}

func New(source Source, config Config) *Service { return &Service{source, config} }

type Resource struct {
	ID            string              `json:"id"`
	Kind          string              `json:"kind"`
	Name          string              `json:"name"`
	Job           string              `json:"job"`
	Instance      string              `json:"instance"`
	Health        string              `json:"health"`
	LastScrape    string              `json:"lastScrape"`
	LastCollected *float64            `json:"lastCollected"`
	Metrics       map[string]*float64 `json:"metrics"`
}
type Summary struct {
	TargetsUp    int      `json:"targetsUp"`
	TargetsTotal int      `json:"targetsTotal"`
	Pending      int      `json:"pending"`
	Firing       int      `json:"firing"`
	HostCount    int      `json:"hostCount"`
	CPU          *float64 `json:"cpu"`
	Memory       *float64 `json:"memory"`
	RPS          *float64 `json:"rps"`
	Errors       *float64 `json:"errors"`
	P95          *float64 `json:"p95"`
	TrafficState string   `json:"trafficState"`
}
type Overview struct {
	Summary   Summary                `json:"summary"`
	Targets   []Target               `json:"targets"`
	Resources []Resource             `json:"resources"`
	Rules     []Rule                 `json:"rules"`
	Alerts    []Alert                `json:"alerts"`
	Metrics   map[string]QueryResult `json:"metrics"`
	Errors    map[string]string      `json:"errors"`
	QueriedAt string                 `json:"queriedAt"`
}
type ChartResult struct {
	Metric Metric      `json:"metric"`
	Data   QueryResult `json:"data"`
	Error  string      `json:"error,omitempty"`
}
type Charts struct {
	Window    Window        `json:"window"`
	Results   []ChartResult `json:"results"`
	QueriedAt string        `json:"queriedAt"`
}

func (s *Service) Integrations(ctx context.Context) map[string]SourceStatus {
	p, g := s.source.Status(ctx)
	return map[string]SourceStatus{"prometheus": p, "grafana": g}
}
func (s *Service) Targets(ctx context.Context, f Filter) ([]Target, error) {
	if e := f.Validate(); e != nil {
		return nil, e
	}
	all, e := s.source.Targets(ctx)
	if e != nil {
		return nil, e
	}
	out := []Target{}
	for _, t := range all {
		if Matches(f, t) {
			out = append(out, t)
		}
	}
	return out, nil
}
func (s *Service) Rules(ctx context.Context, f Filter) ([]Rule, []Alert, error) {
	if e := f.Validate(); e != nil {
		return nil, nil, e
	}
	all, e := s.source.Rules(ctx)
	if e != nil {
		return nil, nil, e
	}
	rules := []Rule{}
	alerts := []Alert{}
	for _, rule := range all {
		matched := []Alert{}
		for _, a := range rule.Alerts {
			kind := s.kind(a.Labels["job"])
			if Matches(f, Target{Kind: kind, Job: a.Labels["job"], Instance: a.Labels["instance"]}) {
				matched = append(matched, a)
				alerts = append(alerts, a)
			}
		}
		// Inactive rules have no dynamic instance labels. Keep their definitions
		// visible, explicitly separate from the filtered list of active alerts.
		if len(matched) > 0 || f.Resource == "" || f.Resource == "all" || rule.Labels["coreops_resource"] == f.Resource || rule.Labels["coreops_resource"] == "target" {
			rule.Alerts = matched
			rules = append(rules, rule)
		}
	}
	return rules, alerts, nil
}
func (s *Service) kind(job string) string {
	if job == s.config.NodeJob {
		return "host"
	}
	if job == s.config.APIJob {
		return "coreops"
	}
	return "target"
}
func scalar(q QueryResult) *float64 {
	if len(q.Series) == 1 && len(q.Series[0].Points) > 0 {
		return q.Series[0].Points[len(q.Series[0].Points)-1].Value
	}
	return nil
}
func instanceValue(q QueryResult, t Target) *float64 {
	for _, series := range q.Series {
		if series.Labels["job"] == t.Job && series.Labels["instance"] == t.Instance && len(series.Points) > 0 {
			return series.Points[len(series.Points)-1].Value
		}
	}
	return nil
}
func (s *Service) Overview(ctx context.Context, f Filter, at ...int64) (Overview, error) {
	out := Overview{Targets: []Target{}, Resources: []Resource{}, Rules: []Rule{}, Alerts: []Alert{}, Metrics: map[string]QueryResult{}, Errors: map[string]string{}}
	if e := f.Validate(); e != nil {
		return out, e
	}
	// Alert/target retrieval errors are fatal for this snapshot: never replace
	// unknown target/alert state with zeros or an empty "healthy" list.
	targets, e := s.Targets(ctx, f)
	if e != nil {
		return out, e
	}
	rules, alerts, e := s.Rules(ctx, f)
	if e != nil {
		return out, e
	}
	out.Targets = targets
	out.Rules = rules
	out.Alerts = alerts
	ids := []string{"host_cpu", "host_memory", "host_disk_worst", "host_uptime", "host_info", "host_collected_at", "api_rps", "api_errors", "api_p95", "api_rps_instance", "api_p95_instance", "api_inflight", "api_memory", "api_goroutines"}
	catalog := Catalog(s.config, f)
	var mu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, 4)
	for _, id := range ids {
		m := catalog[id]
		if f.Resource != "" && f.Resource != "all" && f.Resource != m.Kind {
			continue
		}
		wg.Add(1)
		go func(id string, m Metric) {
			defer wg.Done()
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			case <-ctx.Done():
				return
			}
			var instant *Window
			if len(at) > 0 {
				instant = &Window{To: at[0]}
			}
			v, e := s.source.Query(ctx, m.Expression, instant)
			mu.Lock()
			defer mu.Unlock()
			if e != nil {
				out.Errors[id] = e.Error()
			} else {
				out.Metrics[id] = v
			}
		}(id, m)
	}
	wg.Wait()
	if e := ctx.Err(); e != nil {
		return out, e
	}
	out.Summary.TargetsTotal = len(targets)
	for _, t := range targets {
		if t.Health == "up" {
			out.Summary.TargetsUp++
		}
		if t.Kind != "host" && t.Kind != "coreops" {
			continue
		}
		r := Resource{ID: t.ID, Kind: t.Kind, Name: t.Instance, Job: t.Job, Instance: t.Instance, Health: t.Health, LastScrape: t.LastScrape, Metrics: map[string]*float64{}}
		if t.Kind == "host" {
			out.Summary.HostCount++
			for _, id := range []string{"host_cpu", "host_memory", "host_disk_worst", "host_uptime"} {
				r.Metrics[id] = instanceValue(out.Metrics[id], t)
			}
			r.LastCollected = instanceValue(out.Metrics["host_collected_at"], t)
			for _, v := range out.Metrics["host_info"].Series {
				if v.Labels["instance"] == t.Instance && v.Labels["job"] == t.Job && v.Labels["nodename"] != "" {
					r.Name = v.Labels["nodename"]
				}
			}
		} else {
			r.Metrics["api_rps"] = instanceValue(out.Metrics["api_rps_instance"], t)
			r.Metrics["api_p95"] = instanceValue(out.Metrics["api_p95_instance"], t)
		}
		out.Resources = append(out.Resources, r)
	}
	if out.Summary.HostCount == 1 {
		for _, r := range out.Resources {
			if r.Kind == "host" {
				out.Summary.CPU = r.Metrics["host_cpu"]
				out.Summary.Memory = r.Metrics["host_memory"]
			}
		}
	}
	for _, a := range alerts {
		if a.State == "firing" {
			out.Summary.Firing++
		} else if a.State == "pending" {
			out.Summary.Pending++
		}
	}
	out.Summary.RPS = scalar(out.Metrics["api_rps"])
	out.Summary.Errors = scalar(out.Metrics["api_errors"])
	out.Summary.P95 = scalar(out.Metrics["api_p95"])
	out.Summary.TrafficState = "no_data"
	if out.Errors["api_rps"] != "" {
		out.Summary.TrafficState = "query_error"
	} else if v := out.Summary.RPS; v != nil {
		if *v == 0 {
			out.Summary.TrafficState = "idle"
		} else {
			out.Summary.TrafficState = "traffic"
		}
	}
	sort.Slice(out.Resources, func(i, j int) bool { return out.Resources[i].Name < out.Resources[j].Name })
	out.QueriedAt = time.Now().UTC().Format(time.RFC3339)
	return out, nil
}
func (s *Service) Charts(ctx context.Context, f Filter, w Window, ids []string) (Charts, error) {
	out := Charts{Window: w, Results: []ChartResult{}}
	if e := f.Validate(); e != nil {
		return out, e
	}
	if e := w.Validate(time.Now()); e != nil {
		return out, e
	}
	if len(ids) < 1 || len(ids) > 8 {
		return out, ErrFilter
	}
	catalog := Catalog(s.config, f)
	seen := map[string]bool{}
	for _, id := range ids {
		m, ok := catalog[id]
		if !ok || seen[id] || f.Resource != "" && f.Resource != "all" && f.Resource != m.Kind {
			return out, fmt.Errorf("%w: unsupported metric selection", ErrFilter)
		}
		seen[id] = true
	}
	out.Results = make([]ChartResult, len(ids))
	var wg sync.WaitGroup
	slots := make(chan struct{}, 4)
	for i, id := range ids {
		wg.Add(1)
		go func(i int, id string) {
			defer wg.Done()
			m := catalog[id]
			entry := ChartResult{Metric: m, Data: QueryResult{Series: []Series{}, Warnings: []string{}}}
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			case <-ctx.Done():
				entry.Error = "Query canceled"
				out.Results[i] = entry
				return
			}
			v, e := s.source.Query(ctx, m.Expression, &w)
			if e != nil {
				entry.Error = e.Error()
			} else {
				entry.Data = v
			}
			out.Results[i] = entry
		}(i, id)
	}
	wg.Wait()
	if e := ctx.Err(); e != nil {
		return out, e
	}
	out.QueriedAt = time.Now().UTC().Format(time.RFC3339)
	return out, nil
}
func (s *Service) Resource(ctx context.Context, id string, w Window) (Resource, []Alert, Charts, error) {
	if e := w.Validate(time.Now()); e != nil {
		return Resource{}, nil, Charts{}, e
	}
	targets, e := s.Targets(ctx, Filter{})
	if e != nil {
		return Resource{}, nil, Charts{}, e
	}
	var target *Target
	for _, t := range targets {
		if t.ID == id {
			v := t
			target = &v
			break
		}
	}
	if target == nil {
		return Resource{}, nil, Charts{}, ErrNotFound
	}
	f := Filter{Resource: target.Kind, Job: target.Job, Instance: target.Instance}
	if f.Resource != "host" && f.Resource != "coreops" {
		return Resource{}, nil, Charts{}, ErrFilter
	}
	overview, e := s.Overview(ctx, f, w.To)
	if e != nil {
		return Resource{}, nil, Charts{}, e
	}
	ids := []string{"host_cpu", "host_memory", "host_disk", "host_rx", "host_tx", "host_uptime"}
	if target.Kind == "coreops" {
		ids = []string{"api_rps", "api_errors", "api_p50", "api_p95", "api_p99", "api_inflight", "api_memory", "api_goroutines"}
	}
	charts, e := s.Charts(ctx, f, w, ids)
	if e != nil {
		return Resource{}, nil, Charts{}, e
	}
	if len(overview.Resources) != 1 {
		return Resource{}, nil, Charts{}, errors.New("resource changed; refresh inventory")
	}
	return overview.Resources[0], overview.Alerts, charts, nil
}
func (s *Service) GrafanaLink(kind string, f Filter, w Window) (string, error) {
	if e := f.Validate(); e != nil {
		return "", e
	}
	if e := w.Validate(time.Now()); e != nil {
		return "", e
	}
	if kind != "host" && kind != "coreops" {
		return "", ErrFilter
	}
	if s.config.GrafanaPublicURL == "" {
		return "", errors.New("Grafana public URL is not configured")
	}
	uid := s.config.HostDashboard
	if kind == "coreops" {
		uid = s.config.APIDashboard
	}
	u, e := url.Parse(s.config.GrafanaPublicURL)
	if e != nil {
		return "", e
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/d/" + url.PathEscape(uid)
	q := u.Query()
	q.Set("from", fmt.Sprint(w.From*1000))
	q.Set("to", fmt.Sprint(w.To*1000))
	q.Set("timezone", "browser")
	job := f.Job
	if job == "" {
		job = s.config.NodeJob
		if kind == "coreops" {
			job = s.config.APIJob
		}
	}
	q.Set("var-job", job)
	if f.Instance != "" {
		q.Set("var-instance", f.Instance)
	} else {
		q.Set("var-instance", "$__all")
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}
