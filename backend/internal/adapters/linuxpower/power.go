package linuxpower

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/ppdev28/CoreOps/backend/internal/adapters/helperpath"
	"github.com/ppdev28/CoreOps/backend/internal/hostpower"
)

var helper = helperpath.Path("coreops-power")

type Adapter struct {
	run     func(context.Context, string, ...string) ([]byte, error)
	trusted func() bool
}

func New() *Adapter { return &Adapter{run: run, trusted: trustedHelper} }

type bounded struct{ bytes.Buffer }

func (b *bounded) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 8192 {
		return 0, errors.New("power command output limit")
	}
	return b.Buffer.Write(p)
}
func run(ctx context.Context, path string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C", "LC_ALL=C"}
	var output bounded
	cmd.Stdout = &output
	cmd.Stderr = &output
	err := cmd.Run()
	return output.Bytes(), err
}
func trustedHelper() bool {
	for _, name := range []string{filepath.Dir(helper), helper} {
		info, err := os.Lstat(name)
		if err != nil || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0022 != 0 {
			return false
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 {
			return false
		}
		if name == helper && (!info.Mode().IsRegular() || info.Mode().Perm()&0100 == 0) {
			return false
		}
	}
	return true
}
func (a *Adapter) states(ctx context.Context) (map[string]string, string) {
	if a.trusted() {
		data, err := a.run(ctx, "/usr/bin/sudo", "-n", "--", helper, "status")
		var status struct {
			Protocol int               `json:"protocol"`
			States   map[string]string `json:"states"`
		}
		if err == nil && json.Unmarshal(data, &status) == nil && status.Protocol == 1 {
			return status.States, "helper"
		}
	}
	states := map[string]string{}
	for _, v := range []struct{ action, method string }{{"poweroff", "CanPowerOff"}, {"reboot", "CanReboot"}, {"suspend", "CanSuspend"}} {
		data, err := a.run(ctx, "/usr/bin/busctl", "--system", "--timeout=2", "call", "org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager", v.method)
		if err == nil {
			states[v.action] = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(data)), "s "))
		}
		states[v.action] = strings.Trim(states[v.action], `"`)
	}
	return states, "direct"
}
func (a *Adapter) Inspect(ctx context.Context) (hostpower.Info, error) {
	host, err := os.Hostname()
	if err != nil {
		return hostpower.Info{}, err
	}
	boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return hostpower.Info{}, err
	}
	states, mode := a.states(ctx)
	info := hostpower.Info{Hostname: host, BootID: strings.TrimSpace(string(boot)), Mode: mode, Actions: []hostpower.Action{}}
	for _, id := range []string{"poweroff", "suspend", "reboot"} {
		action := hostpower.Action{ID: id, Available: states[id] == "yes"}
		if !action.Available {
			switch states[id] {
			case "na":
				action.Reason = "The operating system does not support this action."
			case "challenge", "no":
				action.Reason = "Host permissions do not allow this action without administrator setup."
			default:
				action.Reason = "The host power capability could not be verified."
			}
		}
		info.Actions = append(info.Actions, action)
	}
	return info, nil
}
func (a *Adapter) Execute(ctx context.Context, action string) error {
	if !hostpower.ValidAction(action) {
		return hostpower.ErrInvalid
	}
	var err error
	// Capability collection already happened before the final authorization /
	// audit guard. Do not add slow probes between that guard and dispatch.
	if a.trusted() {
		_, err = a.run(ctx, "/usr/bin/sudo", "-n", "--", helper, action)
	} else {
		_, err = a.run(ctx, "/usr/bin/systemctl", "--no-ask-password", "--check-inhibitors=yes", "--no-block", action)
	}
	if err != nil {
		return errors.New("the host did not confirm acceptance of the power request; permissions, active inhibitors or connectivity may have blocked it. Check the host before submitting another request")
	}
	return nil
}
