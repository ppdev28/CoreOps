package security

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/netip"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type EventQuery struct {
	Category  string
	Cursor    string
	Direction string
	Limit     int
}
type Signal struct {
	ObservedAt  string   `json:"observedAt"`
	ID          string   `json:"id"`
	Rule        string   `json:"rule"`
	Severity    string   `json:"severity"`
	Summary     string   `json:"summary"`
	Count       int      `json:"count"`
	EvidenceIDs []string `json:"evidenceIds"`
}
type EventPage struct {
	Events       []Event      `json:"events"`
	Signals      []Signal     `json:"signals"`
	OldestCursor string       `json:"oldestCursor"`
	NewestCursor string       `json:"newestCursor"`
	HasMore      bool         `json:"hasMore"`
	Source       SourceStatus `json:"source"`
	UpdatedAt    string       `json:"updatedAt"`
}
type EventSource interface {
	Events(context.Context, EventQuery) (EventPage, error)
}

var cursorPattern = regexp.MustCompile(`^[A-Za-z0-9_=;:.-]+$`)

func ValidEventQuery(q EventQuery) bool {
	if q.Limit < 1 || q.Limit > 200 || q.Cursor != "" && (len(q.Cursor) > 2048 || !cursorPattern.MatchString(q.Cursor)) {
		return false
	}
	if q.Direction != "older" && q.Direction != "newer" {
		return false
	}
	if q.Direction == "newer" && q.Cursor == "" {
		return false
	}
	switch q.Category {
	case "all", "ssh", "tailscale", "kernel", "audit", "auth", "sensors":
		return true
	}
	return false
}
func (s *Service) Events(ctx context.Context, q EventQuery) (EventPage, error) {
	if !ValidEventQuery(q) {
		return EventPage{}, ErrInvalid
	}
	if source, ok := s.source.(EventSource); ok {
		return source.Events(ctx, q)
	}
	return EventPage{}, ErrUnavailable
}
func DecodeEvents(text string, q EventQuery) EventPage {
	p := EventPage{Events: []Event{}, Signals: []Signal{}, Source: SourceStatus{State: "ok"}, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	invalid := 0
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var row struct {
			Cursor     string `json:"__CURSOR"`
			Timestamp  string `json:"__REALTIME_TIMESTAMP"`
			Message    string `json:"MESSAGE"`
			Unit       string `json:"_SYSTEMD_UNIT"`
			Identifier string `json:"SYSLOG_IDENTIFIER"`
			Transport  string `json:"_TRANSPORT"`
		}
		if json.Unmarshal([]byte(line), &row) != nil {
			invalid++
			continue
		}
		stamp, err := strconv.ParseInt(row.Timestamp, 10, 64)
		if err != nil || stamp <= 0 || row.Message == "" || (len(row.Cursor) > 2048 || !cursorPattern.MatchString(row.Cursor)) {
			invalid++
			continue
		}
		if q.Direction == "older" && row.Cursor == q.Cursor {
			continue
		}
		if len(p.Events) == q.Limit {
			p.HasMore = true
			break
		}
		sum := sha256.Sum256([]byte(row.Cursor))
		source := row.Unit
		if source == "" {
			source = row.Identifier
		}
		if source == "" {
			source = row.Transport
		}
		truncated := len(row.Message) > 16384
		if truncated {
			row.Message = row.Message[:16384]
		}
		p.Events = append(p.Events, Event{ID: hex.EncodeToString(sum[:]), Cursor: row.Cursor, Timestamp: time.UnixMicro(stamp).UTC().Format(time.RFC3339Nano), Type: Classify(row.Message), Message: row.Message, Source: source, Truncated: truncated})
	}
	if len(p.Events) > 0 {
		first, last := p.Events[0].Cursor, p.Events[len(p.Events)-1].Cursor
		if q.Direction == "newer" {
			p.OldestCursor = first
			p.NewestCursor = last
		} else {
			p.NewestCursor = first
			p.OldestCursor = last
		}
	}
	if invalid > 0 {
		p.Source = SourceStatus{State: "partial", Detail: strconv.Itoa(invalid) + " journal records could not be decoded; coverage is incomplete"}
	}
	p.Signals = AnalyzeEvents(p.Events)
	return p
}

var integrityChange = regexp.MustCompile(`(?i)(?:added|removed|changed)\s+entries:\s*[1-9][0-9]*`)
var originIP = regexp.MustCompile(`(?i)(?:from\s+|SRC=|src=)([0-9a-f:.]+)`)

// Signals are bounded heuristics over supplied evidence, never a verdict of intrusion.
func AnalyzeEvents(events []Event) []Signal {
	out := []Signal{}
	failures := map[string][]Event{}
	for _, e := range events {
		m := strings.ToLower(e.Message)
		if strings.Contains(m, "failed password") || strings.Contains(m, "authentication failure") || strings.Contains(m, "invalid user") {
			if match := originIP.FindStringSubmatch(e.Message); len(match) > 1 {
				if ip, err := netip.ParseAddr(match[1]); err == nil {
					failures[ip.String()] = append(failures[ip.String()], e)
				}
			}
		}
		rule, severity := "", "warning"
		switch {
		case strings.Contains(m, "apparmor=\"denied\"") || strings.Contains(m, "avc:  denied"):
			rule = "access-control-denial"
		case strings.Contains(strings.ToLower(e.Source), "aide") && (integrityChange.MatchString(e.Message) || strings.Contains(m, "differences found") || strings.Contains(m, "failed")):
			rule = "file-integrity-change"
			severity = "high"
		case strings.HasSuffix(strings.TrimSpace(m), " found") && (strings.Contains(strings.ToLower(e.Source), "clam") || strings.Contains(e.Source, "coreops-malware")):
			rule = "malware-signature"
			severity = "high"
		case strings.Contains(strings.ToLower(e.Source), "falco") || strings.Contains(strings.ToLower(e.Source), "suricata") || strings.Contains(strings.ToLower(e.Source), "wazuh"):
			if e.Type == "error" || strings.Contains(m, "alert") {
				rule = "sensor-alert"
				severity = "high"
			}
		}
		if rule != "" {
			out = append(out, Signal{ObservedAt: e.Timestamp, ID: e.ID + ":" + rule, Rule: rule, Severity: severity, Summary: "Observed " + rule + "; inspect the source event", Count: 1, EvidenceIDs: []string{e.ID}})
		}
	}
	for ip, rows := range failures {
		if len(rows) < 5 {
			continue
		}
		ids := []string{}
		newest := time.Time{}
		for _, e := range rows {
			t, err := time.Parse(time.RFC3339Nano, e.Timestamp)
			if err == nil && t.After(newest) {
				newest = t
			}
		}
		for _, e := range rows {
			t, err := time.Parse(time.RFC3339Nano, e.Timestamp)
			if err == nil && newest.Sub(t) <= 5*time.Minute {
				ids = append(ids, e.ID)
			}
		}
		if len(ids) >= 5 {
			sum := sha256.Sum256([]byte(ip + strings.Join(ids, ":")))
			out = append(out, Signal{ObservedAt: newest.UTC().Format(time.RFC3339Nano), ID: hex.EncodeToString(sum[:]), Rule: "repeated-auth-failures", Severity: "warning", Summary: "At least five authentication failures from " + ip + " within five minutes of this evidence window", Count: len(ids), EvidenceIDs: ids})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	if len(out) > 200 {
		out = out[:200]
	}
	return out
}
