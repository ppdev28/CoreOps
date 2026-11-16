//go:build linux

package linuxsecurity

import (
	"context"
	"fmt"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestProcStatWithSpacesAndParentheses(t *testing.T) {
	raw := "123 (sshd (user)) S 42 " + strings.Repeat("0 ", 17) + "9876 0"
	parent, start, e := statIdentity(raw)
	if e != nil || parent != 42 || start != "9876" {
		t.Fatal(parent, start, e)
	}
	for _, bad := range []string{"", "1 (bad)", "1 (bad) S nope"} {
		if _, _, e := statIdentity(bad); e == nil {
			t.Fatal("invalid stat accepted")
		}
	}
}
func TestWhoEnrichmentDoesNotUseYearAsPIDOrInventLocalSSH(t *testing.T) {
	s := []core.Session{{PID: 12345, User: "pepe", Terminal: "pts/4"}}
	enrichWho(s, "pepe pts/4 2026-11-16 10:31 . 12345 (100.64.1.2)\npepe pts/8 2026-11-16 10:32 . 2222 (local)")
	if s[0].PID != 12345 || s[0].Since != "2026-11-16 10:31" || s[0].From != "100.64.1.2" {
		t.Fatal(s)
	}
}
func TestAuthenticatedTitleAndProtectedProcesses(t *testing.T) {
	for _, title := range []string{"sshd: pepe@pts/4", "sshd-session: pepe@notty", "sshd: pepe@pts/4,pts/5"} {
		if !authenticatedTitle.MatchString(title) {
			t.Fatal(title)
		}
	}
	for _, title := range []string{"sshd: pepe [priv]", "sshd: [accepted]", "/usr/sbin/sshd -D", "sshd: pepe [preauth]"} {
		if authenticatedTitle.MatchString(title) {
			t.Fatal(title)
		}
	}
	if !protected(1) || !protected(os.Getpid()) || !protected(os.Getppid()) {
		t.Fatal("API ancestry not protected")
	}
}
func TestArbitraryOwnedProcessCannotBeTerminated(t *testing.T) {
	cmd := exec.Command("/usr/bin/sleep", "20")
	if e := cmd.Start(); e != nil {
		t.Fatal(e)
	}
	defer func() { cmd.Process.Kill(); cmd.Wait() }()
	if trustedExecutable(cmd.Process.Pid) {
		t.Fatal("sleep accepted as SSH")
	}
	b, e := os.ReadFile(fmt.Sprintf("/proc/%d/stat", cmd.Process.Pid))
	if e != nil {
		t.Fatal(e)
	}
	_, start, e := statIdentity(string(b))
	if e != nil {
		t.Fatal(e)
	}
	e = New().Signal(context.Background(), core.Session{PID: cmd.Process.Pid, StartTicks: start, ID: strings.Repeat("a", 64), Verified: true, CanTerminate: true})
	if e == nil {
		t.Fatal("arbitrary sleep received signal")
	}
}
func TestFixedProbesRejectUnknownOperations(t *testing.T) {
	if _, e := New().Probe(context.Background(), "sshd; reboot"); e == nil {
		t.Fatal("unknown operation accepted")
	}
}

func TestSocketPeerOnlyEnrichesMatchingProcess(t *testing.T) {
	rows := []core.Session{{PID: 123, From: ""}, {PID: 456, From: "known-origin"}}
	enrichPeers(rows, `0 0 192.0.2.1:22 192.0.2.55:6000 users:(("sshd",pid=123,fd=4))
0 0 192.0.2.1:22 192.0.2.99:6001 users:(("sshd",pid=456,fd=4))`)
	if rows[0].From != "192.0.2.55:6000" || rows[1].From != "known-origin" {
		t.Fatal(rows)
	}
}
