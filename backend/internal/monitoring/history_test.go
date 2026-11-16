package monitoring

import (
	"context"
	"errors"
	"testing"
	"time"
)

type source struct {
	points []HistoryPoint
	called bool
}

func (s *source) Read(context.Context, time.Time, time.Time) (Archive, error) {
	s.called = true
	return Archive{Samples: s.points}, nil
}
func TestHistoryRangeFilteringOrderingAndEmpty(t *testing.T) {
	now := time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)
	value := 25.0
	raw := &source{points: []HistoryPoint{{Time: now.Add(-2 * time.Hour).UnixMilli(), CPU: &value}, {Time: now.Add(-25 * time.Hour).UnixMilli(), CPU: &value}, {Time: now.Add(-3 * time.Hour).UnixMilli(), CPU: &value}, {Time: now.Add(-2 * time.Hour).UnixMilli(), CPU: &value}, {Time: now.Add(time.Hour).UnixMilli(), CPU: &value}}}
	h := NewHistory(raw)
	if _, e := h.Query(t.Context(), "../../../", now); !errors.Is(e, ErrRange) || raw.called {
		t.Fatal("invalid range reached source")
	}
	result, e := h.Query(t.Context(), "24h", now)
	if e != nil || len(result.Samples) != 2 || result.Samples[0].Time > result.Samples[1].Time || result.From != now.Add(-24*time.Hour).UnixMilli() {
		t.Fatal(e, result)
	}
	result, e = h.Query(t.Context(), "5m", now)
	if e != nil || result.Samples == nil || len(result.Samples) != 0 {
		t.Fatal("empty history is not explicit", e, result)
	}
}
