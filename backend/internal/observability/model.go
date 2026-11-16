// Package observability owns read-only observability contracts and PromQL
// definitions. Prometheus alone evaluates alerts; CoreOps does not create incidents.
package observability

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode"
)

var ErrFilter = errors.New("invalid observability filter")
var ErrUnavailable = errors.New("observability source unavailable")
var ErrLimit = errors.New("observability query exceeds its limits")
var ErrNotFound = errors.New("monitored resource not found")

type Filter struct {
	Resource string `json:"resource"`
	Job      string `json:"job"`
	Instance string `json:"instance"`
}

func (f Filter) Validate() error {
	if f.Resource != "" && f.Resource != "all" && f.Resource != "host" && f.Resource != "coreops" {
		return ErrFilter
	}
	for _, s := range []string{f.Job, f.Instance} {
		if len(s) > 200 || strings.IndexFunc(s, unicode.IsControl) >= 0 {
			return ErrFilter
		}
	}
	return nil
}

type Window struct {
	From int64 `json:"from"`
	To   int64 `json:"to"`
	Step int64 `json:"step"`
}

func (w Window) Validate(now time.Time) error {
	if w.From <= 0 || w.To <= w.From || w.To > now.Unix()+60 || w.To-w.From > 30*86400 || w.Step < 5 || w.Step > 86400 || (w.To-w.From)/w.Step+1 > 1000 {
		return fmt.Errorf("%w: use a range up to 30 days, step >=5 seconds and <=1000 points", ErrFilter)
	}
	return nil
}

type Point struct {
	Time  int64    `json:"time"`
	Value *float64 `json:"value"`
}
type Series struct {
	Labels map[string]string `json:"labels"`
	Points []Point           `json:"points"`
}
type QueryResult struct {
	Series   []Series `json:"series"`
	Warnings []string `json:"warnings"`
}
type Target struct {
	ID             string  `json:"id"`
	Kind           string  `json:"kind"`
	Job            string  `json:"job"`
	Instance       string  `json:"instance"`
	Health         string  `json:"health"`
	LastScrape     string  `json:"lastScrape"`
	LastError      string  `json:"lastError"`
	ScrapeDuration float64 `json:"scrapeDuration"`
	ScrapeInterval string  `json:"scrapeInterval"`
}
type Alert struct {
	Name        string            `json:"name"`
	State       string            `json:"state"`
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	ActiveAt    string            `json:"activeAt"`
	Value       *float64          `json:"value"`
	Expression  string            `json:"expression"`
	Duration    float64           `json:"duration"`
	Health      string            `json:"health"`
	LastError   string            `json:"lastError"`
}
type Rule struct {
	Name        string            `json:"name"`
	State       string            `json:"state"`
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	Expression  string            `json:"expression"`
	Duration    float64           `json:"duration"`
	Health      string            `json:"health"`
	LastError   string            `json:"lastError"`
	Alerts      []Alert           `json:"alerts"`
}
type SourceStatus struct {
	Configured bool   `json:"configured"`
	Healthy    bool   `json:"healthy"`
	Endpoint   string `json:"endpoint"`
	PublicURL  string `json:"publicUrl,omitempty"`
	Error      string `json:"error,omitempty"`
	Version    string `json:"version,omitempty"`
}
type Source interface {
	Status(context.Context) (SourceStatus, SourceStatus)
	Targets(context.Context) ([]Target, error)
	Rules(context.Context) ([]Rule, error)
	Query(context.Context, string, *Window) (QueryResult, error)
}
type Metric struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	Unit        string `json:"unit"`
	Description string `json:"description"`
	Expression  string `json:"expression"`
}

func Value(raw string) *float64 {
	v, e := strconv.ParseFloat(raw, 64)
	if e != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	return &v
}
func Matches(f Filter, t Target) bool {
	return (f.Resource == "" || f.Resource == "all" || f.Resource == t.Kind) && (f.Job == "" || f.Job == t.Job) && (f.Instance == "" || f.Instance == t.Instance)
}
