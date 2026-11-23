package security

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSecurityOriginsRejectNonSecurityOrUntrusted(t *testing.T) {
	timer := "LoadState=loaded\nActiveState=active\nUnitFileState=enabled"
	base := "APT::Periodic::Update-Package-Lists \"1\";\nAPT::Periodic::Unattended-Upgrade \"1\";\nCoreOps::OS::ID \"ubuntu\";\nCoreOps::OS::Codename \"resolute\";\n"
	for _, tc := range []struct {
		origin string
		want   bool
	}{{"Ubuntu:resolute-security", true}, {"${distro_id}:${distro_codename}-security", true}, {"Example:custom", false}, {"Example:resolute-security", false}, {"Ubuntu:resolute-updates", false}} {
		c := AutoUpdates(base+"Unattended-Upgrade::Allowed-Origins:: \""+tc.origin+"\";", timer, nil, nil)
		if c.OK == nil || *c.OK != tc.want {
			t.Fatal(tc, c)
		}
	}
}
func journalLine(id string, stamp int64, msg, source string) string {
	b, _ := json.Marshal(map[string]string{"__CURSOR": id, "__REALTIME_TIMESTAMP": fmt.Sprint(stamp), "MESSAGE": msg, "_SYSTEMD_UNIT": source})
	return string(b)
}
func TestEventPagesKeepCursorsAndPartialEvidence(t *testing.T) {
	data := journalLine("s=three", 3000000, "Failed password from 192.0.2.1 port 22", "ssh.service") + "\n" + journalLine("s=two", 2000000, "accepted", "tailscaled.service") + "\n" + journalLine("s=one", 1000000, "[UFW BLOCK] SRC=192.0.2.2", "kernel")
	p := DecodeEvents(data, EventQuery{Category: "all", Direction: "older", Limit: 2})
	if len(p.Events) != 2 || !p.HasMore || p.NewestCursor != "s=three" || p.OldestCursor != "s=two" {
		t.Fatal(p)
	}
	p = DecodeEvents(data, EventQuery{Category: "all", Direction: "older", Cursor: "s=three", Limit: 2})
	if len(p.Events) != 2 || p.Events[0].Cursor != "s=two" {
		t.Fatal(p)
	}
	p = DecodeEvents("bad\n"+data, EventQuery{Category: "all", Direction: "older", Limit: 2})
	if p.Source.State != "partial" {
		t.Fatal("malformed evidence hidden")
	}
	for _, q := range []EventQuery{{Category: "all", Direction: "newer", Limit: 2}, {Category: "all", Direction: "older", Cursor: "--bad\ninject", Limit: 2}, {Category: "other", Direction: "older", Limit: 1}} {
		if ValidEventQuery(q) {
			t.Fatal(q)
		}
	}
}
func TestSignalsRequireEvidenceAndTimeWindow(t *testing.T) {
	rows := []Event{}
	for i := 0; i < 5; i++ {
		rows = append(rows, Event{ID: fmt.Sprint(i), Timestamp: time.Unix(int64(1000+i), 0).UTC().Format(time.RFC3339Nano), Message: "Failed password for root from 192.0.2.1 port 22"})
	}
	if len(AnalyzeEvents(rows[:4])) != 0 || len(AnalyzeEvents(rows)) != 1 {
		t.Fatal("authentication threshold")
	}
	rows[0].Timestamp = time.Unix(1, 0).UTC().Format(time.RFC3339Nano)
	if len(AnalyzeEvents(rows)) != 0 {
		t.Fatal("old failures included")
	}
	if len(AnalyzeEvents([]Event{{ID: "id", Source: "clamav-daemon.service", Message: "/tmp/eicar: Eicar-Test-Signature FOUND"}})) != 1 {
		t.Fatal("malware signature not surfaced")
	}
	if len(AnalyzeEvents([]Event{{ID: "id", Source: "application.service", Message: "/tmp/file FOUND"}})) != 0 {
		t.Fatal("arbitrary found classified as malware")
	}
}

type testCheckpoint struct {
	value Checkpoint
	fail  bool
}

func (s *testCheckpoint) Load() (Checkpoint, error) { return s.value, nil }
func (s *testCheckpoint) Save(v Checkpoint) error {
	if s.fail {
		return errors.New("disk failed")
	}
	s.value = v
	return nil
}

type monitorSource struct {
	pages []EventPage
	calls int
}

func (s *monitorSource) Events(_ context.Context, q EventQuery) (EventPage, error) {
	s.calls++
	if len(s.pages) == 0 {
		return EventPage{Events: []Event{}, Source: SourceStatus{State: "ok"}}, nil
	}
	p := s.pages[0]
	s.pages = s.pages[1:]
	return p, nil
}
func TestMonitorDoesNotAdvanceOnPersistenceFailure(t *testing.T) {
	page := EventPage{Events: []Event{{ID: "id", Timestamp: time.Now().UTC().Format(time.RFC3339Nano)}}, NewestCursor: "s=one", UpdatedAt: "now", Source: SourceStatus{State: "ok"}}
	store := &testCheckpoint{fail: true}
	source := &monitorSource{pages: []EventPage{page, page}}
	m := NewMonitor(source, store)
	m.Collect(context.Background())
	if store.value.Cursor != "" || m.Status().State != "error" {
		t.Fatal(m.Status())
	}
	store.fail = false
	m.Collect(context.Background())
	if store.value.Cursor != "s=one" || m.Status().RetainedEvents != 1 {
		t.Fatal(m.Status())
	}
}
func TestMonitorFollowsEveryBacklogPage(t *testing.T) {
	initial := Checkpoint{Cursor: "s=initial"}
	store := &testCheckpoint{value: initial}
	source := &monitorSource{}
	for i := 0; i < 3; i++ {
		source.pages = append(source.pages, EventPage{Events: []Event{{ID: fmt.Sprint(i), Timestamp: time.Unix(int64(i), 0).UTC().Format(time.RFC3339Nano)}}, NewestCursor: fmt.Sprintf("s=%d", i), UpdatedAt: "now", HasMore: i < 2, Source: SourceStatus{State: "ok"}})
	}
	m := NewMonitor(source, store)
	m.Collect(context.Background())
	if source.calls != 3 || store.value.Cursor != "s=2" || m.Status().RetainedEvents != 3 || m.Status().Backlog {
		t.Fatal(m.Status(), source.calls)
	}
	denied := func() error { return ErrPermission }
	if m.Reset(denied) != ErrPermission || store.value.Cursor != "s=2" {
		t.Fatal("unauthorized reset")
	}
}
func TestSecurityGuardsRequiredAndFailuresBlockEffects(t *testing.T) {
	f := &fixture{sessions: []Session{{ID: strings.Repeat("a", 64), PID: 123, Verified: true, CanTerminate: true}}, state: SourceStatus{State: "ok"}}
	s := New(f)
	if _, e := s.Terminate(context.Background(), 123, strings.Repeat("a", 64), nil); e != ErrPermission {
		t.Fatal(e)
	}
	if _, e := s.Terminate(context.Background(), 123, strings.Repeat("a", 64), func(next func() error) error { return ErrPermission }); e != ErrPermission || f.signalled != 0 {
		t.Fatal(e)
	}
}

type fakeScanner struct {
	mu     sync.Mutex
	calls  int
	finish chan struct{}
}

func (s *fakeScanner) Capabilities(context.Context) (ScanCapability, error) {
	return ScanCapability{Available: true, Hostname: "owned", BootID: "boot", Targets: []ScanTarget{{ID: "host"}}}, nil
}
func (s *fakeScanner) Scan(ctx context.Context, _ string) (ScanReport, error) {
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	select {
	case <-s.finish:
		return ScanReport{Packages: 1, Vulnerabilities: []Vulnerability{}}, nil
	case <-ctx.Done():
		return ScanReport{}, ctx.Err()
	}
}
func TestScanJobsBindIdentitySerializeAndDeduplicate(t *testing.T) {
	scanner := &fakeScanner{finish: make(chan struct{})}
	jobs := NewScanJobs(context.Background(), scanner)
	r := ScanRequest{Target: "host", Hostname: "owned", BootID: "boot", RequestID: strings.Repeat("a", 32)}
	deny := func() error { return ErrPermission }
	if _, e := jobs.Start(context.Background(), r, "actor", deny); e != ErrPermission {
		t.Fatal(e)
	}
	allow := func() error { return nil }
	one, e := jobs.Start(context.Background(), r, "actor", allow)
	if e != nil {
		t.Fatal(e)
	}
	replay, e := jobs.Start(context.Background(), r, "actor", allow)
	if e != nil || replay.ID != one.ID {
		t.Fatal(e)
	}
	r.RequestID = strings.Repeat("b", 32)
	if _, e = jobs.Start(context.Background(), r, "actor", allow); e != ErrConflict {
		t.Fatal(e)
	}
	close(scanner.finish)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if jobs.Jobs()[0].Status == "succeeded" {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("scan job did not complete")
}
