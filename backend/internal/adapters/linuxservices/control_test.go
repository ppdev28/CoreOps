package linuxservices

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestServiceTargetPolicy(t *testing.T) {
	for _, unit := range []string{"alsa-restore.service", "ssh.service", "getty@tty1.service", "user@1000.service"} {
		if !ValidUnit(unit) {
			t.Fatal(unit)
		}
	}
	for _, unit := range []string{"-H.service", "../ssh.service", "ssh.service --force", "*.service", "reboot.target", strings.Repeat("a", 256) + ".service"} {
		if ValidUnit(unit) {
			t.Fatal("unsafe target", unit)
		}
	}
	for _, unit := range []string{"coreops.service", "systemd-reboot.service", "systemd-poweroff.service", "systemd-suspend.service"} {
		if !Protected(unit) {
			t.Fatal("unprotected lifecycle", unit)
		}
	}
}
func TestServiceHelperBindingAndNoArbitraryArgv(t *testing.T) {
	var calls []string
	c := &Control{trusted: func() bool { return true }, run: func(_ context.Context, op string, input []byte) ([]byte, error) {
		calls = append(calls, op)
		if op == "check" {
			return []byte(`{"protocol":1,"ok":true,"ready":true}`), nil
		}
		var r map[string]string
		if err := json.Unmarshal(input, &r); err != nil {
			t.Fatal(err)
		}
		if len(r) != 2 || r["unit"] != "alsa-restore.service" || r["action"] != "stop" {
			t.Fatal(r)
		}
		return []byte(`{"protocol":1,"ok":true,"unit":"alsa-restore.service","action":"stop","canonicalUnit":"alsa-restore.service"}`), nil
	}}
	if err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := c.Execute(context.Background(), "alsa-restore.service", "stop"); err != nil {
		t.Fatal(err)
	}
	for _, unit := range []string{"../alsa.service", "-x.service", "coreops.service"} {
		if c.Execute(context.Background(), unit, "stop") == nil {
			t.Fatal(unit)
		}
	}
	if c.Execute(context.Background(), "ssh.service", "enable") == nil || len(calls) != 2 {
		t.Fatal("unexpected calls", calls)
	}
}
func TestServiceBrokerFailsClosed(t *testing.T) {
	for _, data := range []string{`{}`, `sudo: interactive authentication is required`, `{"protocol":2,"ok":true}`, `{"protocol":1,"ok":true,"unit":"other.service","action":"stop","canonicalUnit":"other.service"}`, `{"protocol":1,"ok":true,"unit":"alsa-restore.service","action":"stop","canonicalUnit":"coreops.service"}`} {
		c := &Control{trusted: func() bool { return true }, run: func(context.Context, string, []byte) ([]byte, error) { return []byte(data), nil }}
		if err := c.Execute(context.Background(), "alsa-restore.service", "stop"); err == nil {
			t.Fatal(data)
		}
	}
	c := &Control{trusted: func() bool { return false }, run: func(context.Context, string, []byte) ([]byte, error) {
		t.Fatal("untrusted helper executed")
		return nil, nil
	}}
	if !errors.Is(c.Check(context.Background()), ErrPermission) {
		t.Fatal("missing permission state")
	}
}
func TestServiceHelperFailureIsNotSuccess(t *testing.T) {
	c := &Control{trusted: func() bool { return true }, run: func(context.Context, string, []byte) ([]byte, error) {
		return []byte(`{"protocol":1,"ok":false,"code":"uncertain","error":"deadline"}`), errors.New("exit 1")
	}}
	if !errors.Is(c.Execute(context.Background(), "alsa-restore.service", "stop"), ErrUncertain) {
		t.Fatal("uncertain result accepted")
	}
	c.run = func(context.Context, string, []byte) ([]byte, error) {
		return []byte(`{"protocol":1,"ok":true,"ready":true}`), errors.New("command failed")
	}
	if c.Check(context.Background()) == nil {
		t.Fatal("failed transport accepted")
	}
}
func TestServiceCommandCancellationAndOutputBound(t *testing.T) {
	c := New()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.command(ctx, "check", nil); err == nil {
		t.Fatal("cancelled command ran")
	}
	var output bounded
	if _, err := output.Write(make([]byte, 8193)); err == nil {
		t.Fatal("unbounded helper output")
	}
}
