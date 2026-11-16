package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

const updateHelper = "/usr/local/libexec/coreops-packages"

type aptRunner struct{}

func (aptRunner) List(ctx context.Context) (UpdatesOverview, error) { return collectUpdates(ctx) }
func (aptRunner) Check(ctx context.Context) error {
	if os.Geteuid() == 0 {
		return nil
	}
	info, e := os.Lstat(updateHelper)
	var owned bool
	if e == nil {
		if st, ok := info.Sys().(*syscall.Stat_t); ok {
			owned = st.Uid == 0
		}
	}
	if e != nil || !owned || !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 {
		return errors.New("Package operations need the root-owned CoreOps APT helper and its restricted sudo rule. See docs/modules/updates.md; no host permissions have been changed")
	}
	for dir := filepath.Dir(updateHelper); ; dir = filepath.Dir(dir) {
		parent, err := os.Lstat(dir)
		if err != nil || !parent.IsDir() || parent.Mode().Perm()&0022 != 0 {
			return errors.New("The APT helper directory must be root-owned and not writable by other users")
		}
		st, ok := parent.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != 0 {
			return errors.New("The APT helper directory must be root-owned")
		}
		if dir == "/" {
			break
		}
	}
	out, e := runPackageCommand(ctx, 12000, "/usr/bin/sudo", "-n", "--", updateHelper, "check")
	if e != nil || strings.TrimSpace(out) != "coreops-packages ready" {
		return errors.New("The service user cannot run the CoreOps APT helper without a password. Install the restricted sudo rule for that service user; see docs/modules/updates.md")
	}
	return nil
}
func (aptRunner) Run(ctx context.Context, action string, packages []string) (string, error) {
	var name string
	var args []string
	if os.Geteuid() == 0 {
		name = "/usr/bin/apt-get"
		args = []string{"-o", "APT::Update::Error-Mode=any", "-o", "DPkg::Lock::Timeout=15"}
		switch action {
		case "refresh":
			args = append(args, "update")
		case "upgrade":
			args = append(args, "-y", "--with-new-pkgs", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold", "upgrade")
		case "apply":
			args = append(args, "-y", "--only-upgrade", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold", "install", "--")
			args = append(args, packages...)
		default:
			return "", errors.New("unsupported package operation")
		}
	} else {
		name = "/usr/bin/sudo"
		args = []string{"-n", "--", updateHelper, action}
		args = append(args, packages...)
	}
	out, e := runPackageCommand(ctx, 12000, name, args...)
	if e == nil {
		return out, nil
	}
	if ctx.Err() != nil {
		return out, errors.New("package operation exceeded its deadline; check APT/dpkg state before retrying")
	}
	msg := "Package operation failed; inspect its output before retrying"
	lower := strings.ToLower(out)
	switch {
	case strings.Contains(lower, "lock"):
		msg = "APT/dpkg is busy or could not acquire its lock; wait for the existing package operation. Do not delete lock files"
	case strings.Contains(lower, "password") || strings.Contains(lower, "permission denied") || strings.Contains(lower, "not allowed"):
		msg = "Service user lacks package management permission; configure the restricted CoreOps APT helper"
	case strings.Contains(lower, "dpkg was interrupted"):
		msg = "dpkg reports an interrupted operation; an administrator must repair it before retrying"
	}
	return out, errors.New(msg)
}

type outputTail struct {
	mu    sync.Mutex
	data  []byte
	limit int
	total int
}

func (b *outputTail) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	b.total += n
	b.data = append(b.data, p...)
	if len(b.data) > b.limit {
		b.data = append([]byte{}, b.data[len(b.data)-b.limit:]...)
	}
	return n, nil
}
func runPackageCommand(ctx context.Context, limit int, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "HOME=/root", "LC_ALL=C", "LANG=C", "DEBIAN_FRONTEND=noninteractive", "NEEDRESTART_MODE=l"}
	cmd.WaitDelay = time.Second
	output := &outputTail{limit: limit}
	cmd.Stdout = output
	cmd.Stderr = output
	err := cmd.Run()
	output.mu.Lock()
	defer output.mu.Unlock()
	text := string(output.data)
	if output.total > limit {
		text = "[Earlier output omitted]\n" + text
	}
	return text, err
}

// Only apt's read-only list uses this compatibility helper. Never automatically
// retry a failed privileged mutation with sudo.
func runUpdateCommand(ctx context.Context, name string, args ...string) (string, error) {
	if name != "apt" {
		return "", errors.New("unsupported package listing command")
	}
	out, e := runPackageCommand(ctx, 512*1024, filepath.Join("/usr/bin", name), args...)
	if strings.HasPrefix(out, "[Earlier output omitted]") {
		return "", fmt.Errorf("package index exceeds listing limit")
	}
	return out, e
}
