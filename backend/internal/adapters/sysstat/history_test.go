package sysstat

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ppdev28/CoreOps/backend/internal/monitoring"
)

func archiveJSON(cpu, memory string) string {
	return fmt.Sprintf(`{"sysstat":{"hosts":[{"statistics":[{"timestamp":{"date":"2026-11-15","time":"23:50:00","utc":1,"interval":600},"cpu-load":%s,"memory":%s}],"restarts":[]}]}}`, cpu, memory)
}

const allCPU = `[{"cpu":"all","idle":70,"iowait":5}]`
const allMemory = `{"memfree":10,"memused":20,"buffers":5,"cached":50,"slab":15,"avail":60}`

func TestHistoryParserUsesMeasuredAggregateAndMatchingMemory(t *testing.T) {
	s, e := parse([]byte(archiveJSON(allCPU, allMemory)))
	if e != nil || len(s) != 1 {
		t.Fatal(e, s)
	}
	if *s[0].CPU != 25 || *s[0].Memory != 40 || s[0].Time != time.Date(2026, 11, 15, 23, 50, 0, 0, time.UTC).UnixMilli() || s[0].IntervalMS != 600000 {
		t.Fatal(s[0])
	}
	for _, body := range []string{archiveJSON(`[{"cpu":"0","idle":70,"iowait":0}]`, allMemory), archiveJSON(`[{"cpu":"all","idle":-1,"iowait":0}]`, allMemory), archiveJSON(`[{"cpu":"all","idle":70}]`, allMemory)} {
		s, e := parse([]byte(body))
		if e != nil || s[0].CPU != nil {
			t.Fatal("invented aggregate CPU", s, e)
		}
	}
	s, e = parse([]byte(archiveJSON(allCPU, `{"memused-percent":19,"avail":60}`)))
	if e != nil || s[0].Memory != nil {
		t.Fatal("missing memory guessed")
	}
	_, e = parse([]byte(strings.ReplaceAll(archiveJSON(allCPU, allMemory), `"utc":1`, `"utc":0`)))
	if e == nil {
		t.Fatal("non-UTC timestamp accepted")
	}
}
func TestHistoryReaderConfinementBoundedCommandAndCache(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"sa15", "sa20261115"} {
		if e := os.WriteFile(filepath.Join(dir, n), []byte("archive"), 0600); e != nil {
			t.Fatal(e)
		}
	}
	secret := filepath.Join(t.TempDir(), "private")
	os.WriteFile(secret, []byte("secret"), 0600)
	os.Symlink(secret, filepath.Join(dir, "sa16"))
	os.Mkdir(filepath.Join(dir, "sa17"), 0700)
	fake := filepath.Join(t.TempDir(), "sadf")
	calls := filepath.Join(t.TempDir(), "calls")
	body := archiveJSON(allCPU, allMemory)
	script := fmt.Sprintf("#!/bin/sh\ntest \"$1\" = -j || exit 11\ntest \"$2\" = /proc/self/fd/3 || exit 12\ntest \"$3\" = -- || exit 13\ntest \"$4\" = -u || exit 14\ntest \"$5\" = -r || exit 15\ntest \"$6\" = ALL || exit 16\ntest -z \"$COREOPS_ADMIN_PASSWORD\" || exit 17\ncat /proc/self/fd/3 >/dev/null || exit 18\nprintf 'call\\n' >> '%s'\ncat <<'JSON'\n%s\nJSON\n", calls, body)
	os.WriteFile(fake, []byte(script), 0700)
	t.Setenv("COREOPS_ADMIN_PASSWORD", "must-not-be-inherited")
	r := NewReader(dir)
	r.command = fake
	from := time.Date(2026, 11, 15, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	a, e := r.Read(t.Context(), from, to)
	if e != nil || len(a.Samples) != 2 || len(a.Warnings) != 0 {
		t.Fatal(e, a)
	}
	_, e = r.Read(t.Context(), from, to)
	if e != nil {
		t.Fatal(e)
	}
	v, _ := os.ReadFile(calls)
	if strings.Count(string(v), "call") != 2 {
		t.Fatal("unchanged archives were decoded again")
	}
	os.WriteFile(filepath.Join(dir, "sa15"), []byte("changed archive"), 0600)
	_, e = r.Read(t.Context(), from, to)
	if e != nil {
		t.Fatal(e)
	}
	v, _ = os.ReadFile(calls)
	if strings.Count(string(v), "call") != 3 {
		t.Fatal("cache did not detect archive growth")
	}
}
func TestHistoryReadMissingToolAndCancellation(t *testing.T) {
	r := NewReader(t.TempDir())
	r.command = ""
	if _, e := r.Read(t.Context(), time.Now().Add(-time.Hour), time.Now()); !errors.Is(e, monitoring.ErrUnavailable) {
		t.Fatal(e)
	}
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "sa16"), []byte("x"), 0600)
	r = NewReader(dir)
	r.command = "/bin/sleep"
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	start := time.Now()
	if _, e := r.Read(ctx, start.Add(-time.Hour), start); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if time.Since(start) > time.Second {
		t.Fatal("cancellation ignored")
	}
}
func TestHistoryRealSysstatArchives(t *testing.T) {
	if os.Getenv("COREOPS_TEST_SYSSTAT") != "1" {
		t.Skip("explicit read-only host history integration")
	}
	r := NewReader("/var/log/sysstat")
	now := time.Now().UTC()
	a, e := r.Read(t.Context(), now.Add(-24*time.Hour), now)
	if e != nil {
		t.Fatal(e)
	}
	if len(a.Samples) < 2 {
		t.Fatal("no retained history")
	}
	hasOlder := false
	for _, p := range a.Samples {
		if p.Time < now.Add(-time.Hour).UnixMilli() && p.CPU != nil {
			hasOlder = true
		}
	}
	if !hasOlder {
		t.Fatal("history did not include prior hours")
	}
	t.Logf("Read %d retained host samples without changing sysstat", len(a.Samples))
}
