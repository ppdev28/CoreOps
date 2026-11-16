//go:build linux

package linuxsecurity

import (
	"context"
	"errors"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

func fixtureTailscale() (loginRecord, map[string]string, map[int]processEvidence) {
	login := loginRecord{User: "pepe", Terminal: "pts/5", PID: 12345, Since: "2026-11-16 18:18", From: "100.105.4.60"}
	info := map[string]string{"Id": "19067", "Name": "pepe", "User": "1000", "Remote": "yes", "RemoteHost": "100.105.4.60", "State": "active", "TTY": "pts/5", "Leader": "12340", "Scope": "session-19067.scope", "Timestamp": "Mon 2026-11-16 18:18:53 UTC"}
	group := "0::/user.slice/user-1000.slice/session-19067.scope\n"
	processes := map[int]processEvidence{
		12345: {PID: 12345, ParentPID: 12340, UID: 1000, EUID: 1000, Start: "123456", State: "S", Name: "bash", Cgroup: group},
		12340: {PID: 12340, ParentPID: 12330, UID: 0, EUID: 0, Start: "123450", State: "S", Name: "login", Cgroup: group},
		12330: {PID: 12330, ParentPID: 12300, UID: 0, EUID: 0, Start: "123440", State: "S", Name: "tailscaled", Args: []string{"/usr/sbin/tailscaled", "be-child", "ssh-monitor", "--uid=1000", "--local-user=pepe"}},
		12300: {PID: 12300, ParentPID: 1, UID: 0, EUID: 0, Start: "123000", State: "S", Name: "tailscaled", Cgroup: "0::/system.slice/tailscaled.service\n"},
	}
	return login, info, processes
}
func TestLoginctlUsesRepeatedPropertiesAndParsesMultipleSessions(t *testing.T) {
	args := logindArgs([]string{"19067", "c2", "--all", "bad;id"})
	if !reflect.DeepEqual(args[:3], []string{"show-session", "19067", "c2"}) {
		t.Fatal(args)
	}
	for _, name := range loginProperties {
		found := false
		for _, arg := range args {
			if arg == "--property="+name {
				found = true
			}
		}
		if !found {
			t.Fatal("missing property", name)
		}
	}
	for _, arg := range args {
		if strings.HasPrefix(arg, "--property=") && strings.Contains(arg, ",") {
			t.Fatal("unsupported comma properties", arg)
		}
	}
	rows := parseLogind("Id=19067\nName=pepe\nRemote=yes\n\nId=c2\nName=other\nState=closing\n")
	if len(rows) != 2 || rows[0]["Name"] != "pepe" || rows[1]["State"] != "closing" {
		t.Fatal(rows)
	}
}
func TestTailscaleTerminalRequiresLiveLoginAndDaemonAncestry(t *testing.T) {
	login, info, processes := fixtureTailscale()
	read := func(pid int) (processEvidence, error) {
		p, ok := processes[pid]
		if !ok {
			return p, errors.New("missing process")
		}
		return p, nil
	}
	s, ok := tailscaleSession("boot", login, info, read)
	if !ok || s.Method != "Tailscale SSH" || s.Terminal != "pts/5" || s.From != "100.105.4.60" || s.UID != 1000 || s.LoginID != "19067" || s.Process != "bash" || len(s.ID) != 64 || s.CanTerminate || s.Verified {
		t.Fatal(s, ok)
	}
	for _, tc := range []struct{ key, value string }{{"State", "closing"}, {"Remote", "no"}, {"Name", "another-user"}, {"User", "1001"}, {"TTY", "pts/9"}, {"Leader", "999"}, {"Scope", "session-c2.scope"}} {
		original := info[tc.key]
		info[tc.key] = tc.value
		if _, ok := tailscaleSession("boot", login, info, read); ok {
			t.Fatal("accepted mismatched login", tc)
		}
		info[tc.key] = original
	}
	for _, mutate := range []func(){func() { p := processes[12345]; p.State = "Z"; processes[12345] = p }, func() { p := processes[12330]; p.UID = 1000; processes[12330] = p }, func() {
		p := processes[12330]
		p.Args = []string{"tailscaled", "be-child", "ssh-monitor", "--uid=1001", "--local-user=pepe"}
		processes[12330] = p
	}, func() {
		p := processes[12330]
		p.Args = []string{"tailscaled", "be-child", "other-service"}
		processes[12330] = p
	}, func() { p := processes[12300]; p.Name = "bash"; processes[12300] = p }, func() { p := processes[12300]; p.Cgroup = "0::/user.slice\n"; processes[12300] = p }, func() {
		p := processes[12345]
		p.Cgroup = "0::/user.slice/session-190670.scope\n"
		processes[12345] = p
	}} {
		_, _, original := fixtureTailscale()
		processes = original
		mutate()
		if _, ok := tailscaleSession("boot", login, info, read); ok {
			t.Fatal("accepted forged/stale process ancestry")
		}
	}
}
func TestLogindEnrichmentIncludesRemoteHostAndLoginTime(t *testing.T) {
	_, info, _ := fixtureTailscale()
	sessions := []core.Session{{User: "pepe", LoginID: "19067"}}
	enrichLogind(sessions, []map[string]string{info})
	if sessions[0].From != "100.105.4.60" || sessions[0].Since != info["Timestamp"] || sessions[0].SinceSource != "logind" {
		t.Fatal(sessions)
	}
}
func TestReadOnlyLiveTailscaleTerminal(t *testing.T) {
	tty := os.Getenv("COREOPS_EXPECT_SSH_TTY")
	if tty == "" {
		t.Skip("set COREOPS_EXPECT_SSH_TTY to inspect an existing terminal without modifying it")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, state, err := New().Sessions(ctx)
	if err != nil || state.State != "ok" {
		t.Fatal(state, err)
	}
	for _, v := range rows {
		if v.Terminal == tty && v.Method == "Tailscale SSH" {
			if v.CanTerminate {
				t.Fatal("Tailscale actions must remain disabled")
			}
			t.Logf("Detected existing Tailscale SSH session: %s, %s, origin %s, PID %d, logind %s", v.User, v.Terminal, v.From, v.PID, v.LoginID)
			return
		}
	}
	t.Fatalf("live Tailscale terminal %s not found in %+v", tty, rows)
}

func TestWhoCLocaleMonthFormatDoesNotInventYear(t *testing.T) {
	rows := parseWho("pepe pts/5 Nov 16 18:18 00:14 1406026 (100.105.4.60)\npepe pts/6 2026-11-16 18:20 . 1410000 (192.0.2.5)")
	if len(rows) != 2 || rows[0].PID != 1406026 || rows[0].Since != "" || rows[0].From != "100.105.4.60" || rows[1].Since != "2026-11-16 18:20" {
		t.Fatal(rows)
	}
}
