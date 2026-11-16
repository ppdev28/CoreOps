package observability

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

type fixture struct{ broken bool }

func (f fixture) Status(context.Context) (SourceStatus, SourceStatus) {
	return SourceStatus{}, SourceStatus{}
}
func (f fixture) Targets(context.Context) ([]Target, error) {
	if f.broken {
		return nil, ErrUnavailable
	}
	return []Target{{ID: "a", Kind: "host", Job: "nodes", Instance: "one", Health: "up"}, {ID: "b", Kind: "host", Job: "nodes", Instance: "two", Health: "down"}}, nil
}
func (f fixture) Rules(context.Context) ([]Rule, error) {
	return []Rule{{Name: "TargetDown", Labels: map[string]string{"coreops_resource": "target"}, Alerts: []Alert{{Name: "TargetDown", State: "pending", Labels: map[string]string{"job": "nodes", "instance": "two"}}}}}, nil
}
func (f fixture) Query(_ context.Context, expr string, _ *Window) (QueryResult, error) {
	if strings.Contains(expr, "histogram_quantile") {
		return QueryResult{}, errors.New("query unavailable")
	}
	return QueryResult{Series: []Series{{Labels: map[string]string{"job": "nodes", "instance": "one"}, Points: []Point{{Time: 1, Value: Value("10")}}}, {Labels: map[string]string{"job": "nodes", "instance": "two"}, Points: []Point{{Time: 1, Value: Value("90")}}}}}, nil
}
func TestOverviewDoesNotInventAggregatesOrHealthyState(t *testing.T) {
	s := New(fixture{}, Config{NodeJob: "nodes", APIJob: "api"})
	o, e := s.Overview(context.Background(), Filter{})
	if e != nil {
		t.Fatal(e)
	}
	if o.Summary.CPU != nil || o.Summary.Memory != nil || o.Summary.Pending != 1 || o.Summary.TargetsUp != 1 || o.Summary.TargetsTotal != 2 || o.Errors["api_p95"] == "" {
		t.Fatalf("invalid overview %+v", o)
	}
	o, e = s.Overview(context.Background(), Filter{Resource: "host", Instance: "one"})
	if e != nil || o.Summary.CPU == nil || *o.Summary.CPU != 10 || o.Summary.Pending != 0 {
		t.Fatal(o, e)
	}
	_, e = New(fixture{broken: true}, Config{}).Overview(context.Background(), Filter{})
	if !errors.Is(e, ErrUnavailable) {
		t.Fatal("failure reported as healthy", e)
	}
}
func TestCatalogFiltersHistogramAndFiniteValues(t *testing.T) {
	job := `x"} or up{job="attacker`
	c := Catalog(Config{NodeJob: "nodes", APIJob: "api"}, Filter{Job: job, Instance: "host:9100"})
	for _, m := range c {
		if !strings.Contains(m.Expression, "job="+strconv.Quote(job)) || !strings.Contains(m.Expression, `instance="host:9100"`) {
			t.Fatal("filter omitted/unsafe", m)
		}
	}
	if !strings.Contains(c["api_p95"].Expression, "sum by(le)") || !strings.Contains(c["api_p95"].Expression, `transport="http"`) {
		t.Fatal("quantile aggregation invalid")
	}
	if !strings.Contains(c["host_disk_worst"].Expression, "max by(job,instance)") {
		t.Fatal("disk aggregate invalid")
	}
	for _, raw := range []string{"NaN", "+Inf", "-Inf", "bad"} {
		if Value(raw) != nil {
			t.Fatal(raw)
		}
	}
	if v := Value("0"); v == nil || *v != 0 {
		t.Fatal("real zero lost")
	}
}
func TestWindowCatalogBoundsAndGrafanaContext(t *testing.T) {
	now := time.Now().Unix()
	w := Window{From: now - 3600, To: now, Step: 15}
	s := New(fixture{}, Config{NodeJob: "nodes", APIJob: "api", GrafanaPublicURL: "https://grafana.example/subpath", HostDashboard: "coreops-host", APIDashboard: "coreops-backend"})
	link, e := s.GrafanaLink("host", Filter{Instance: "one:9100"}, w)
	if e != nil {
		t.Fatal(e)
	}
	u, _ := url.Parse(link)
	if u.Path != "/subpath/d/coreops-host" || u.Query().Get("var-instance") != "one:9100" || u.Query().Get("var-job") != "nodes" || u.Query().Get("from") != strconv.FormatInt(w.From*1000, 10) {
		t.Fatal(link)
	}
	for _, invalid := range []Window{{From: now - 31*86400, To: now, Step: 86400}, {From: now - 86400, To: now, Step: 5}, {From: now, To: now - 1, Step: 15}, {From: now - 100, To: now + 1000, Step: 15}} {
		if invalid.Validate(time.Now()) == nil {
			t.Fatal(invalid)
		}
	}
	for _, ids := range [][]string{{"up"}, {"host_cpu", "host_cpu"}, {}} {
		if _, e := s.Charts(context.Background(), Filter{}, w, ids); !errors.Is(e, ErrFilter) {
			t.Fatal(ids, e)
		}
	}
	if _, e := s.Charts(context.Background(), Filter{Resource: "host"}, w, []string{"api_rps"}); e == nil {
		t.Fatal("cross resource chart accepted")
	}
}
