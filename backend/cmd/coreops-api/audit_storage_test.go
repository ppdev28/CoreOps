package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAuditRotationChainAndConcurrentWriters(t *testing.T) {
	dir := t.TempDir()
	a, b := NewAuditLog(dir), NewAuditLog(dir)
	a.maxBytes = 2048
	b.maxBytes = 2048
	var wg sync.WaitGroup
	errs := make(chan error, 40)
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			log := a
			if i%2 == 0 {
				log = b
			}
			errs <- log.append(AuditEntry{Time: time.Now().UTC(), Method: "POST", Path: "/security", Detail: strings.Repeat("x", 100)}, true)
		}(i)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	a.mu.Lock()
	state, e := a.verifyLocked()
	a.mu.Unlock()
	if e != nil || state.Files != 4 || state.Sequence != 40 || state.LegacyRecords != 0 {
		t.Fatal(state, e)
	}
	data, e := os.ReadFile(filepath.Join(dir, auditFileName))
	if e != nil {
		t.Fatal(e)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	var last AuditEntry
	if json.Unmarshal([]byte(lines[len(lines)-1]), &last) != nil || last.Hash == "" {
		t.Fatal("missing hash")
	}
	data = []byte(strings.Replace(string(data), strings.Repeat("x", 100), strings.Repeat("y", 100), 1))
	if e = os.WriteFile(filepath.Join(dir, auditFileName), data, 0600); e != nil {
		t.Fatal(e)
	}
	if e = a.AppendDurable(AuditEntry{Time: time.Now().UTC(), Method: "POST"}); e == nil {
		t.Fatal("tampered audit did not block durable dispatch")
	}
}
func TestAuditLegacyMigrationIsExplicit(t *testing.T) {
	dir := t.TempDir()
	line := `{"time":"2026-11-22T00:00:00Z","method":"POST","path":"/legacy","status":200,"remote":"local","durationMs":0}` + "\n"
	if e := os.WriteFile(filepath.Join(dir, auditFileName), []byte(line), 0600); e != nil {
		t.Fatal(e)
	}
	a := NewAuditLog(dir)
	if e := a.AppendDurable(AuditEntry{Time: time.Now().UTC(), Method: "POST"}); e != nil {
		t.Fatal(e)
	}
	s, e := a.verifyLocked()
	if e != nil || s.State != "legacy_partial" || s.LegacyRecords != 1 {
		t.Fatal(s, e)
	}
}

func TestArchivedAuditAliasesRemainSensitive(t *testing.T) {
	dir := t.TempDir()
	api := &API{auditLogPath: filepath.Join(dir, auditFileName)}
	for _, name := range []string{"audit.log.1", "audit.log.2", "audit.log.3", ".audit.lock"} {
		file := filepath.Join(dir, name)
		if err := os.WriteFile(file, []byte("private"), 0600); err != nil {
			t.Fatal(err)
		}
		alias := filepath.Join(t.TempDir(), "unrelated-name.log")
		if err := os.Link(file, alias); err != nil {
			t.Fatal(err)
		}
		f, err := os.Open(alias)
		if err != nil {
			t.Fatal(err)
		}
		sensitive := api.isCoreOpsAudit(f)
		f.Close()
		if !sensitive {
			t.Fatal("archive alias escaped the audit boundary", name)
		}
	}
}
