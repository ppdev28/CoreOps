// Package linuxservices invokes only the root-owned, fixed-argv Services helper.
package linuxservices

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"syscall"
	"time"

	"github.com/ppdev28/CoreOps/backend/internal/adapters/helperpath"
)

var (
	ErrInvalid     = errors.New("invalid system service request")
	ErrPermission  = errors.New("Services management requires the restricted helper and permission; run coreops-setup --add services as administrator")
	ErrProtected   = errors.New("this service requires its dedicated control path")
	ErrNotFound    = errors.New("system service not found")
	ErrUnavailable = errors.New("system service management unavailable")
	ErrUncertain   = errors.New("service outcome is unconfirmed; refresh the unit before another request")
	unitPattern    = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9@_.:-]*\.service$`)
)

func ValidUnit(unit string) bool { return len(unit) <= 255 && unitPattern.MatchString(unit) }
func ValidAction(action string) bool {
	return action == "start" || action == "stop" || action == "restart"
}
func Protected(unit string) bool {
	if unit == "coreops.service" {
		return true
	}
	for _, action := range []string{"reboot", "poweroff", "halt", "kexec", "soft-reboot", "exit", "suspend", "hibernate", "hybrid-sleep", "suspend-then-hibernate", "sleep"} {
		if unit == "systemd-"+action+".service" {
			return true
		}
	}
	return false
}

type Control struct {
	helper  string
	run     func(context.Context, string, []byte) ([]byte, error)
	trusted func() bool
}

func New() *Control {
	c := &Control{helper: helperpath.Path("coreops-services")}
	c.run = c.command
	c.trusted = func() bool { return trusted(c.helper) }
	return c
}
func trusted(path string) bool {
	for current := path; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0022 != 0 {
			return false
		}
		owner, ok := info.Sys().(*syscall.Stat_t)
		if !ok || owner.Uid != 0 {
			return false
		}
		if current == path && (!info.Mode().IsRegular() || info.Mode().Perm()&0100 == 0) {
			return false
		}
		if current != path && !info.IsDir() {
			return false
		}
		if current == "/" {
			return true
		}
	}
}

type bounded struct{ bytes.Buffer }

func (b *bounded) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 8192 {
		return 0, errors.New("service output limit")
	}
	return b.Buffer.Write(p)
}
func (c *Control) command(ctx context.Context, operation string, input []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 9*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/sudo", "-n", "--", c.helper, operation)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C", "LC_ALL=C"}
	cmd.Stdin = bytes.NewReader(input)
	cmd.WaitDelay = time.Second
	var output bounded
	cmd.Stdout = &output
	cmd.Stderr = &output
	err := cmd.Run()
	return output.Bytes(), err
}

type response struct {
	Protocol  int    `json:"protocol"`
	OK        bool   `json:"ok"`
	Ready     bool   `json:"ready"`
	Unit      string `json:"unit"`
	Canonical string `json:"canonicalUnit"`
	Action    string `json:"action"`
	Code      string `json:"code"`
	Error     string `json:"error"`
}

func (c *Control) invoke(ctx context.Context, operation string, input []byte) (response, error) {
	if !c.trusted() {
		return response{}, ErrPermission
	}
	data, callErr := c.run(ctx, operation, input)
	var result response
	if len(data) > 8192 || json.Unmarshal(data, &result) != nil || result.Protocol != 1 {
		if operation == "check" {
			return response{}, ErrPermission
		}
		return response{}, ErrUncertain
	}
	if result.OK && callErr == nil {
		return result, nil
	}
	err := ErrUnavailable
	switch result.Code {
	case "permission":
		err = ErrPermission
	case "invalid":
		err = ErrInvalid
	case "protected":
		err = ErrProtected
	case "not_found":
		err = ErrNotFound
	case "uncertain":
		err = ErrUncertain
	}
	if len(result.Error) > 1200 {
		result.Error = result.Error[:1200]
	}
	return result, fmt.Errorf("%w: %s", err, result.Error)
}
func (c *Control) Check(ctx context.Context) error {
	r, err := c.invoke(ctx, "check", nil)
	if err == nil && !r.Ready {
		return ErrPermission
	}
	return err
}
func (c *Control) Execute(ctx context.Context, unit, action string) error {
	if !ValidUnit(unit) || !ValidAction(action) {
		return ErrInvalid
	}
	if Protected(unit) {
		return ErrProtected
	}
	input, _ := json.Marshal(map[string]string{"unit": unit, "action": action})
	r, err := c.invoke(ctx, "apply", input)
	if err == nil && (r.Unit != unit || r.Action != action || !ValidUnit(r.Canonical) || Protected(r.Canonical)) {
		return ErrUncertain
	}
	return err
}
