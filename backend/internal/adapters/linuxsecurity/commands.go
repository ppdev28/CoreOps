// Package linuxsecurity reads Linux security evidence using bounded, fixed commands.
package linuxsecurity

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/ppdev28/CoreOps/backend/internal/adapters/helperpath"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
)

var helper = helperpath.Path("coreops-security")

type Source struct{}

func New() *Source { return &Source{} }

type limitedBuffer struct {
	bytes.Buffer
	overflow bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	remaining := 512*1024 - b.Len()
	if len(p) > remaining {
		p = p[:remaining]
		b.overflow = true
	}
	_, _ = b.Buffer.Write(p)
	return n, nil
}
func run(ctx context.Context, name string, args ...string) (string, error) {
	return runInput(ctx, nil, name, args...)
}
func runInput(ctx context.Context, input []byte, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	if input != nil {
		cmd.Stdin = bytes.NewReader(input)
	}
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C", "LC_ALL=C"}
	var stdout, stderr limitedBuffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	cmd.WaitDelay = time.Second
	err := cmd.Run()
	if ctx.Err() != nil {
		return "", &core.SourceError{State: "unavailable", Detail: "Host command timed out or was cancelled"}
	}
	if stdout.overflow || stderr.overflow {
		return "", &core.SourceError{State: "error", Detail: "Host command exceeded the output limit"}
	}
	if err != nil {
		detail := strings.TrimSpace(stderr.String() + " " + stdout.String())
		if len(detail) > 1200 {
			detail = detail[:1200]
		}
		state := "error"
		low := strings.ToLower(detail)
		if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) {
			state = "unavailable"
		}
		if strings.Contains(low, "permission denied") || strings.Contains(low, "need to be root") || strings.Contains(low, "not permitted") || strings.Contains(low, "password is required") || strings.Contains(low, "interactive authentication is required") || strings.Contains(low, "a terminal is required") {
			state = "permission_denied"
		}
		return "", &core.SourceError{State: state, Detail: fmt.Sprintf("%s: %s (%v)", name, detail, err)}
	}
	// journalctl can return success while warning that system journals are inaccessible.
	if strings.Contains(stderr.String(), "not seeing messages") || strings.Contains(stderr.String(), "No journal files were opened due to insufficient permissions") {
		return "", &core.SourceError{State: "permission_denied", Detail: "System journal access is incomplete for the API user"}
	}
	return stdout.String(), nil
}
func (s *Source) Probe(ctx context.Context, op string) (string, error) {
	var name string
	var args []string
	switch op {
	case "ufw":
		name = "/usr/sbin/ufw"
		args = []string{"status", "verbose"}
	case "ufw-version":
		name = "/usr/sbin/ufw"
		args = []string{"version"}
	case "sshd":
		name = "/usr/sbin/sshd"
		args = []string{"-T"}
	case "fail2ban":
		name = "/usr/bin/fail2ban-client"
		args = []string{"status"}
	case "apt-policy":
		name = "/usr/bin/apt-config"
		args = []string{"dump"}
	case "upgrade-timer":
		name = "/usr/bin/systemctl"
		args = []string{"show", "apt-daily-upgrade.timer", "--property=LoadState,ActiveState,UnitFileState"}
	case "ports":
		name = "/usr/bin/ss"
		args = []string{"-H", "-lntu"}
	case "events":
		name = "/usr/bin/journalctl"
		args = journalArgs(core.EventQuery{Category: "all", Direction: "older", Limit: 200})
	default:
		return "", core.ErrInvalid
	}
	out, err := run(ctx, name, args...)
	if op == "apt-policy" && err == nil {
		data, e := readSmall("/etc/os-release")
		if e != nil {
			return "", &core.SourceError{State: "unavailable", Detail: "Distribution identity could not be read"}
		}
		values := map[string]string{}
		for _, line := range strings.Split(string(data), "\n") {
			key, value, ok := strings.Cut(line, "=")
			if ok {
				values[key] = strings.Trim(value, "\"'")
			}
		}
		code := values["VERSION_CODENAME"]
		if code == "" {
			code = values["UBUNTU_CODENAME"]
		}
		id, _ := json.Marshal(values["ID"])
		codename, _ := json.Marshal(code)
		out += "\nCoreOps::OS::ID " + string(id) + ";\nCoreOps::OS::Codename " + string(codename) + ";\n"
	}

	if err != nil && core.Status(err).State == "permission_denied" && (op == "ufw" || op == "sshd" || op == "fail2ban") && trustedHelper() {
		return run(ctx, "/usr/bin/sudo", "-n", "--", helper, op)
	}
	return out, err
}
func trustedHelper() bool {
	st, e := os.Lstat(helper)
	if e != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0022 != 0 || st.Mode().Perm()&0100 == 0 || !rootOwned(st) {
		return false
	}
	for p := filepath.Dir(helper); ; p = filepath.Dir(p) {
		st, e = os.Lstat(p)
		if e != nil || !st.IsDir() || !rootOwned(st) || st.Mode().Perm()&0022 != 0 {
			return false
		}
		if p == "/" {
			break
		}
	}
	return true
}
func (s *Source) CanEnableAutoUpdates(ctx context.Context) core.Capability {
	if os.Geteuid() == 0 {
		return core.Capability{Available: true}
	}
	if !trustedHelper() {
		return core.Capability{Reason: "Requires the optional root-owned security helper and a restricted sudo rule for enable-auto-updates"}
	}
	_, err := run(ctx, "/usr/bin/sudo", "-n", "-l", "--", helper, "enable-auto-updates")
	if err != nil {
		return core.Capability{Reason: "The API user has no non-interactive permission to enable the APT timer"}
	}
	return core.Capability{Available: true}
}
func (s *Source) EnableAutoUpdates(ctx context.Context) error {
	var err error
	if os.Geteuid() == 0 {
		_, err = run(ctx, "/usr/bin/systemctl", "enable", "--now", "apt-daily-upgrade.timer")
	} else if trustedHelper() {
		_, err = run(ctx, "/usr/bin/sudo", "-n", "--", helper, "enable-auto-updates")
	} else {
		return core.ErrPermission
	}
	return err
}
