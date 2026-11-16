// Package prometheus adapts the fixed Prometheus/Grafana sources. It is not an
// arbitrary URL or PromQL proxy: only the capability's catalog reaches Query.
package prometheus

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	obs "github.com/ppdev28/CoreOps/backend/internal/observability"
)

type Config struct{ PrometheusURL, GrafanaURL, GrafanaPublicURL, PrometheusToken, GrafanaToken, CAFile, NodeJob, APIJob string }
type cacheEntry struct {
	body  []byte
	until time.Time
}
type Client struct {
	config Config
	http   *http.Client
	mu     sync.Mutex
	cache  map[string]cacheEntry
	slots  chan struct{}
}

func validOrigin(raw string) error {
	if raw == "" {
		return nil
	}
	u, e := url.Parse(raw)
	if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("observability sources require HTTP(S) URLs without credentials, query or fragment")
	}
	return nil
}
func New(c Config) (*Client, error) {
	for _, raw := range []string{c.PrometheusURL, c.GrafanaURL, c.GrafanaPublicURL} {
		if e := validOrigin(raw); e != nil {
			return nil, e
		}
	}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
	if c.CAFile != "" {
		b, e := os.ReadFile(c.CAFile)
		if e != nil {
			return nil, errors.New("cannot read observability certificate authority")
		}
		pool, e := x509.SystemCertPool()
		if e != nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM(b) {
			return nil, errors.New("invalid observability certificate authority")
		}
		tlsConfig.RootCAs = pool
	}
	transport := &http.Transport{Proxy: nil, TLSClientConfig: tlsConfig, MaxIdleConns: 16, MaxIdleConnsPerHost: 8, IdleConnTimeout: 30 * time.Second, ResponseHeaderTimeout: 5 * time.Second}
	return &Client{config: c, http: &http.Client{Transport: transport, Timeout: 7 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, cache: map[string]cacheEntry{}, slots: make(chan struct{}, 8)}, nil
}
func (c *Client) get(ctx context.Context, base, path, token string, q url.Values, cache bool) ([]byte, error) {
	if base == "" {
		return nil, fmt.Errorf("%w: source is not configured", obs.ErrUnavailable)
	}
	target := strings.TrimRight(base, "/") + path
	if len(q) > 0 {
		target += "?" + q.Encode()
	}
	if cache {
		c.mu.Lock()
		entry, ok := c.cache[target]
		c.mu.Unlock()
		if ok && time.Now().Before(entry.until) {
			return entry.body, nil
		}
	}
	select {
	case c.slots <- struct{}{}:
		defer func() { <-c.slots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if e != nil {
		return nil, obs.ErrUnavailable
	}
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	response, e := c.http.Do(req)
	if e != nil {
		return nil, fmt.Errorf("%w: connection failed or timed out", obs.ErrUnavailable)
	}
	defer response.Body.Close()
	if response.StatusCode == 401 || response.StatusCode == 403 {
		return nil, fmt.Errorf("%w: source rejected the backend credentials or permissions (HTTP %d)", obs.ErrUnavailable, response.StatusCode)
	}
	if response.StatusCode != 200 {
		return nil, fmt.Errorf("%w: source returned HTTP %d", obs.ErrUnavailable, response.StatusCode)
	}
	b, e := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
	if e != nil {
		return nil, obs.ErrUnavailable
	}
	if len(b) > 4*1024*1024 {
		return nil, obs.ErrLimit
	}
	if cache {
		c.mu.Lock()
		if len(c.cache) >= 128 {
			clear(c.cache)
		}
		c.cache[target] = cacheEntry{b, time.Now().Add(5 * time.Second)}
		c.mu.Unlock()
	}
	return b, nil
}
func (c *Client) prom(ctx context.Context, path string, q url.Values, out any) error {
	b, e := c.get(ctx, c.config.PrometheusURL, "/api/v1/"+path, c.config.PrometheusToken, q, true)
	if e != nil {
		return e
	}
	var envelope struct {
		Status    string          `json:"status"`
		Data      json.RawMessage `json:"data"`
		Warnings  []string        `json:"warnings"`
		ErrorType string          `json:"errorType"`
	}
	if json.Unmarshal(b, &envelope) != nil || envelope.Status != "success" {
		return fmt.Errorf("%w: invalid or unsuccessful Prometheus API response", obs.ErrUnavailable)
	}
	if json.Unmarshal(envelope.Data, out) != nil {
		return fmt.Errorf("%w: incompatible Prometheus data", obs.ErrUnavailable)
	}
	return nil
}
func (c *Client) Status(ctx context.Context) (obs.SourceStatus, obs.SourceStatus) {
	p := obs.SourceStatus{Configured: c.config.PrometheusURL != "", Endpoint: c.config.PrometheusURL}
	g := obs.SourceStatus{Configured: c.config.GrafanaURL != "", Endpoint: c.config.GrafanaURL, PublicURL: c.config.GrafanaPublicURL}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		call, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		var data struct {
			Version string `json:"version"`
		}
		if e := c.prom(call, "status/buildinfo", nil, &data); e != nil {
			p.Error = e.Error()
		} else {
			p.Healthy = true
			p.Version = data.Version
		}
	}()
	go func() {
		defer wg.Done()
		call, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		b, e := c.get(call, c.config.GrafanaURL, "/api/health", c.config.GrafanaToken, nil, true)
		if e != nil {
			g.Error = e.Error()
			return
		}
		var v struct {
			Database string `json:"database"`
			Version  string `json:"version"`
		}
		if json.Unmarshal(b, &v) != nil || v.Database != "ok" {
			g.Error = "Grafana health check did not report a healthy database"
		} else {
			g.Healthy = true
			g.Version = v.Version
		}
	}()
	wg.Wait()
	return p, g
}
func (c *Client) Targets(ctx context.Context) ([]obs.Target, error) {
	var raw struct {
		Active []struct {
			Labels     map[string]string `json:"labels"`
			Health     string            `json:"health"`
			LastScrape string            `json:"lastScrape"`
			LastError  string            `json:"lastError"`
			Duration   float64           `json:"scrapeDuration"`
			Interval   string            `json:"scrapeInterval"`
		} `json:"activeTargets"`
	}
	if e := c.prom(ctx, "targets", url.Values{"state": {"active"}}, &raw); e != nil {
		return nil, e
	}
	if len(raw.Active) > 200 {
		return nil, fmt.Errorf("%w: more than 200 active targets", obs.ErrLimit)
	}
	out := []obs.Target{}
	for _, t := range raw.Active {
		job, instance := t.Labels["job"], t.Labels["instance"]
		if len(job) > 200 || len(instance) > 200 {
			return nil, obs.ErrLimit
		}
		kind := "target"
		if job == c.config.NodeJob {
			kind = "host"
		}
		if job == c.config.APIJob {
			kind = "coreops"
		}
		sum := sha256.Sum256([]byte(job + "\x00" + instance))
		out = append(out, obs.Target{ID: hex.EncodeToString(sum[:12]), Kind: kind, Job: job, Instance: instance, Health: t.Health, LastScrape: t.LastScrape, LastError: targetError(t.LastError), ScrapeDuration: t.Duration, ScrapeInterval: t.Interval})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Job+out[i].Instance < out[j].Job+out[j].Instance })
	return out, nil
}
func targetError(raw string) string {
	if raw == "" {
		return ""
	}
	l := strings.ToLower(raw)
	switch {
	case strings.Contains(l, "connection refused"):
		return "Connection refused; check exporter process and listen address"
	case strings.Contains(l, "deadline") || strings.Contains(l, "timeout"):
		return "Scrape timed out; check network and exporter responsiveness"
	case strings.Contains(l, "401") || strings.Contains(l, "403"):
		return "Scrape authentication or permissions rejected"
	case strings.Contains(l, "certificate") || strings.Contains(l, "tls"):
		return "Scrape TLS verification failed"
	default:
		return "Scrape failed; inspect this target's exporter and Prometheus configuration"
	}
}
func safeLabels(raw map[string]string) map[string]string {
	out := map[string]string{}
	for _, key := range []string{"job", "instance", "nodename", "device", "mountpoint", "fstype", "method", "route", "code", "transport", "severity", "alertname", "coreops_resource"} {
		if v, ok := raw[key]; ok {
			if len(v) > 250 {
				v = v[:250]
			}
			out[key] = strings.Map(func(r rune) rune {
				if unicode.IsControl(r) {
					return -1
				}
				return r
			}, v)
		}
	}
	return out
}
func (c *Client) Query(ctx context.Context, expression string, w *obs.Window) (obs.QueryResult, error) {
	out := obs.QueryResult{Series: []obs.Series{}, Warnings: []string{}}
	q := url.Values{"query": {expression}, "timeout": {"5s"}, "limit": {"51"}}
	path := "query"
	if w != nil {
		if w.Step == 0 {
			q.Set("time", strconv.FormatInt(w.To, 10))
		} else {
			path = "query_range"
			q.Set("start", strconv.FormatInt(w.From, 10))
			q.Set("end", strconv.FormatInt(w.To, 10))
			q.Set("step", strconv.FormatInt(w.Step, 10))
		}
	}
	b, e := c.get(ctx, c.config.PrometheusURL, "/api/v1/"+path, c.config.PrometheusToken, q, true)
	if e != nil {
		return out, e
	}
	var raw struct {
		Status   string   `json:"status"`
		Warnings []string `json:"warnings"`
		Data     struct {
			Type   string          `json:"resultType"`
			Result json.RawMessage `json:"result"`
		} `json:"data"`
	}
	if json.Unmarshal(b, &raw) != nil || raw.Status != "success" {
		return out, fmt.Errorf("%w: query failed or returned invalid JSON", obs.ErrUnavailable)
	}
	for i, v := range raw.Warnings {
		if i == 10 {
			break
		}
		if len(v) > 300 {
			v = v[:300]
		}
		out.Warnings = append(out.Warnings, v)
	}
	type sample struct {
		Metric map[string]string    `json:"metric"`
		Values [][2]json.RawMessage `json:"values"`
		Value  [2]json.RawMessage   `json:"value"`
	}
	rows := []sample{}
	if raw.Data.Type == "scalar" {
		var pair [2]json.RawMessage
		if json.Unmarshal(raw.Data.Result, &pair) != nil {
			return out, obs.ErrUnavailable
		}
		rows = append(rows, sample{Value: pair})
	} else if raw.Data.Type == "matrix" || raw.Data.Type == "vector" {
		if json.Unmarshal(raw.Data.Result, &rows) != nil {
			return out, obs.ErrUnavailable
		}
	} else {
		return out, fmt.Errorf("%w: unsupported Prometheus result type", obs.ErrUnavailable)
	}
	if len(rows) > 50 {
		return out, fmt.Errorf("%w: more than 50 series; select an instance", obs.ErrLimit)
	}
	for _, row := range rows {
		series := obs.Series{Labels: safeLabels(row.Metric), Points: []obs.Point{}}
		pairs := row.Values
		if raw.Data.Type != "matrix" {
			pairs = [][2]json.RawMessage{row.Value}
		}
		if len(pairs) > 1000 {
			return out, obs.ErrLimit
		}
		for _, pair := range pairs {
			var t float64
			var v string
			if json.Unmarshal(pair[0], &t) != nil || json.Unmarshal(pair[1], &v) != nil || t <= 0 {
				return out, obs.ErrUnavailable
			}
			series.Points = append(series.Points, obs.Point{Time: int64(t * 1000), Value: obs.Value(v)})
		}
		out.Series = append(out.Series, series)
	}
	return out, nil
}
func (c *Client) Rules(ctx context.Context) ([]obs.Rule, error) {
	var raw struct {
		Groups []struct {
			Rules []struct {
				Name        string            `json:"name"`
				Type        string            `json:"type"`
				State       string            `json:"state"`
				Query       string            `json:"query"`
				Duration    float64           `json:"duration"`
				Labels      map[string]string `json:"labels"`
				Annotations map[string]string `json:"annotations"`
				Health      string            `json:"health"`
				LastError   string            `json:"lastError"`
				Alerts      []struct {
					Labels      map[string]string `json:"labels"`
					Annotations map[string]string `json:"annotations"`
					State       string            `json:"state"`
					ActiveAt    string            `json:"activeAt"`
					Value       string            `json:"value"`
				} `json:"alerts"`
			} `json:"rules"`
		} `json:"groups"`
	}
	if e := c.prom(ctx, "rules", url.Values{"type": {"alert"}}, &raw); e != nil {
		return nil, e
	}
	out := []obs.Rule{}
	active := 0
	for _, g := range raw.Groups {
		for _, r := range g.Rules {
			if r.Type != "alerting" {
				continue
			}
			if len(out) >= 200 || len(r.Query) > 5000 {
				return nil, obs.ErrLimit
			}
			rule := obs.Rule{Name: r.Name, State: r.State, Labels: safeLabels(r.Labels), Annotations: annotations(r.Annotations), Expression: r.Query, Duration: r.Duration, Health: r.Health, LastError: targetError(r.LastError), Alerts: []obs.Alert{}}
			for _, a := range r.Alerts {
				active++
				if active > 500 {
					return nil, obs.ErrLimit
				}
				rule.Alerts = append(rule.Alerts, obs.Alert{Name: r.Name, State: a.State, Labels: safeLabels(a.Labels), Annotations: annotations(a.Annotations), ActiveAt: a.ActiveAt, Value: obs.Value(a.Value), Expression: r.Query, Duration: r.Duration, Health: r.Health, LastError: targetError(r.LastError)})
			}
			out = append(out, rule)
		}
	}
	return out, nil
}
func annotations(raw map[string]string) map[string]string {
	out := map[string]string{}
	for _, key := range []string{"summary", "description", "check"} {
		if v := raw[key]; v != "" {
			if len(v) > 2000 {
				v = v[:2000]
			}
			out[key] = v
		}
	}
	return out
}
