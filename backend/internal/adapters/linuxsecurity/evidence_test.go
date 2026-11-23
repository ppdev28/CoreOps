package linuxsecurity

import (
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestJournalCursorForwardReadsOldestNewRecords(t *testing.T) {
	args := strings.Join(journalArgs(core.EventQuery{Category: "all", Cursor: "s=cursor", Direction: "newer", Limit: 100}), " ")
	for _, want := range []string{"--after-cursor=s=cursor", "--lines=+101", "_SYSTEMD_UNIT=tailscaled.service", "_TRANSPORT=kernel", "_TRANSPORT=audit", "SYSLOG_IDENTIFIER=sudo"} {
		if !strings.Contains(args, want) {
			t.Fatal(args)
		}
	}
	if strings.Contains(args, "--reverse") {
		t.Fatal("forward page would skip burst events")
	}
}
func TestCheckpointRejectsLinksAndPersistsPrivate(t *testing.T) {
	dir := t.TempDir()
	s := CheckpointFile{Dir: dir}
	cp := core.Checkpoint{Cursor: "s=one"}
	if e := s.Save(cp); e != nil {
		t.Fatal(e)
	}
	actual, e := s.Load()
	if e != nil || actual.Cursor != cp.Cursor {
		t.Fatal(actual, e)
	}
	path := filepath.Join(dir, CheckpointName)
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
	os.Remove(path)
	os.Symlink(filepath.Join(dir, "other"), path)
	if e = s.Save(cp); e == nil {
		t.Fatal("symlink accepted")
	}
}
func TestFirewallChainsSummarizePoliciesAndDocker(t *testing.T) {
	v, e := firewallChains(`{"nftables":[{"chain":{"family":"ip","table":"filter","name":"DOCKER-USER","hook":"forward","policy":"drop"}},{"rule":{"family":"ip","table":"filter","chain":"DOCKER-USER","expr":[{"accept":null}]}}]}`)
	if e != nil || len(v) != 1 || v[0].Rules != 1 || v[0].Policy != "drop" {
		t.Fatal(v, e)
	}
}
