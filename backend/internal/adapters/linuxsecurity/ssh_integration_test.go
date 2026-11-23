//go:build linux

package linuxsecurity

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	core "github.com/ppdev28/CoreOps/backend/internal/security"
)

// Opt-in: starts a separate loopback-only sshd with temporary keys/configuration.
// It only signals the authenticated child of this test's server, never an existing SSH session.
func TestOwnedSSHSessionLifecycle(t *testing.T) {
	if os.Getenv("COREOPS_TEST_OWNED_SSH") != "1" {
		t.Skip("set COREOPS_TEST_OWNED_SSH=1 to start a disposable loopback sshd")
	}
	if os.Geteuid() == 0 {
		t.Skip("run this opt-in test as a non-root service user; it does not create a host privilege-separation directory")
	}
	u, e := user.Current()
	if e != nil {
		t.Fatal(e)
	}
	dir := t.TempDir()
	key := filepath.Join(dir, "key")
	if out, e := exec.Command("/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", key).CombinedOutput(); e != nil {
		t.Fatal(string(out), e)
	}
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	conf := fmt.Sprintf("Port %d\nListenAddress 127.0.0.1\nHostKey %s\nPidFile %s\nAuthorizedKeysFile %s\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nPermitRootLogin no\nAllowUsers %s\nPrintMotd no\nSubsystem sftp internal-sftp\n", port, key, filepath.Join(dir, "sshd.pid"), key+".pub", u.Username)
	config := filepath.Join(dir, "sshd_config")
	os.WriteFile(config, []byte(conf), 0600)
	log, e := os.Create(filepath.Join(dir, "server.log"))
	if e != nil {
		t.Fatal(e)
	}
	defer log.Close()
	server := exec.Command("/usr/sbin/sshd", "-D", "-e", "-f", config)
	server.Stdout = log
	server.Stderr = log
	if e := server.Start(); e != nil {
		t.Fatal(e)
	}
	defer func() { server.Process.Kill(); server.Wait() }()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	ready := false
	for i := 0; i < 50; i++ {
		c, e := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 50*time.Millisecond)
		if e == nil {
			c.Close()
			ready = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !ready {
		b, _ := os.ReadFile(log.Name())
		t.Fatalf("disposable sshd did not start: %s", b)
	}
	client := exec.CommandContext(ctx, "/usr/bin/ssh", "-F", "/dev/null", "-T", "-p", fmt.Sprint(port), "-i", key, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", u.Username+"@127.0.0.1", "exec sleep 60")
	clientLog, _ := os.Create(filepath.Join(dir, "client.log"))
	defer clientLog.Close()
	client.Stdout = clientLog
	client.Stderr = clientLog
	if e := client.Start(); e != nil {
		t.Fatal(e)
	}
	defer func() { client.Process.Kill(); client.Wait() }()
	source := New()
	var found core.Session
	for i := 0; i < 40; i++ {
		rows, _, e := source.Sessions(ctx)
		if e != nil {
			t.Fatal(e)
		}
		for _, v := range rows {
			stat, _ := readSmall(fmt.Sprintf("/proc/%d/stat", v.ParentPID))
			grandparent, _, _ := statIdentity(string(stat))
			if v.ParentPID == server.Process.Pid || grandparent == server.Process.Pid {
				found = v
				break
			}
		}
		if found.ID != "" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if found.ID == "" {
		b, _ := os.ReadFile(log.Name())
		c, _ := os.ReadFile(clientLog.Name())
		out, _ := run(ctx, "/usr/bin/ps", "-eo", "pid=,ppid=,comm=")
		for _, line := range strings.Split(out, "\n") {
			if strings.Contains(line, "sshd") {
				f := strings.Fields(line)
				pid, _ := strconv.Atoi(f[0])
				cmd, _ := readSmall(fmt.Sprintf("/proc/%d/cmdline", pid))
				t.Logf("SSH candidate %s title=%q", line, string(cmd))
			}
		}
		t.Fatalf("owned SSH child missing: listener PID %d server=%s client=%s", server.Process.Pid, b, c)
	}
	if found.Terminal != "notty" || found.User != u.Username || !found.Verified || !found.CanTerminate {
		t.Fatalf("SSH identity/permissions: %+v", found)
	}
	if _, e := core.New(source).Terminate(ctx, found.PID, found.ID, func(next func() error) error { return next() }); e != nil {
		t.Fatal(e)
	}
	closed := false
	for i := 0; i < 40; i++ {
		rows, state, e := source.Sessions(ctx)
		if e != nil {
			t.Fatal(e)
		}
		exists := false
		for _, v := range rows {
			if v.ID == found.ID {
				exists = true
			}
		}
		if !exists && state.State == "ok" {
			closed = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !closed {
		t.Fatal("termination requested but owned SSH session still present")
	}
	if _, e := os.Stat(fmt.Sprintf("/proc/%d/stat", server.Process.Pid)); e != nil {
		t.Fatal("test listener was incorrectly terminated", e)
	}
	t.Logf("Real loopback SSH session %s · %s · PID %d · origin %s was identified, signalled using pidfd and confirmed closed; dedicated listener survived", found.User, found.Terminal, found.PID, found.From)
}
