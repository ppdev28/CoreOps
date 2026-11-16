// Package monitoring owns host history independently of Linux collection tools.
package monitoring

import (
	"context"
	"errors"
	"sort"
	"time"
)

var ErrRange = errors.New("unsupported monitoring range; use 5m, 15m, 30m, 1h, 6h, 24h, 7d or 30d")
var ErrUnavailable = errors.New("recorded host history is unavailable")
var Ranges = map[string]time.Duration{"5m": 5 * time.Minute, "15m": 15 * time.Minute, "30m": 30 * time.Minute, "1h": time.Hour, "6h": 6 * time.Hour, "24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour}

type HistoryPoint struct {
	Time       int64    `json:"time"`
	CPU        *float64 `json:"cpu"`
	Memory     *float64 `json:"memory"`
	IntervalMS int64    `json:"intervalMs"`
}
type Archive struct {
	Samples  []HistoryPoint
	Warnings []string
}
type HistorySource interface {
	Read(context.Context, time.Time, time.Time) (Archive, error)
}
type History struct{ source HistorySource }

func NewHistory(source HistorySource) *History { return &History{source: source} }

type HistoryResponse struct {
	Source   string         `json:"source"`
	Range    string         `json:"range"`
	From     int64          `json:"from"`
	To       int64          `json:"to"`
	Samples  []HistoryPoint `json:"samples"`
	Warnings []string       `json:"warnings"`
}

func (h *History) Query(ctx context.Context, span string, now time.Time) (HistoryResponse, error) {
	duration, ok := Ranges[span]
	if !ok {
		return HistoryResponse{}, ErrRange
	}
	from := now.Add(-duration)
	raw, e := h.source.Read(ctx, from, now)
	if e != nil {
		return HistoryResponse{}, e
	}
	samples := []HistoryPoint{}
	for _, p := range raw.Samples {
		if p.Time >= from.UnixMilli() && p.Time <= now.UnixMilli() {
			samples = append(samples, p)
		}
	}
	sort.SliceStable(samples, func(i, j int) bool { return samples[i].Time < samples[j].Time })
	// Rotated archives can overlap. Keep one authoritative sample per instant.
	unique := samples[:0]
	for _, p := range samples {
		if len(unique) > 0 && unique[len(unique)-1].Time == p.Time {
			unique[len(unique)-1] = p
		} else {
			unique = append(unique, p)
		}
	}
	warnings := raw.Warnings
	if warnings == nil {
		warnings = []string{}
	}
	return HistoryResponse{Source: "sysstat", Range: span, From: from.UnixMilli(), To: now.UnixMilli(), Samples: unique, Warnings: warnings}, nil
}
