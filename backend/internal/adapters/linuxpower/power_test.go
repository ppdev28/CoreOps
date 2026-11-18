package linuxpower

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestPowerCapabilitiesUseFixedCalls(t *testing.T) {
	var calls []string
	a := &Adapter{trusted: func() bool { return false }, run: func(_ context.Context, exe string, args ...string) ([]byte, error) {
		calls = append(calls, exe+" "+strings.Join(args, " "))
		switch args[len(args)-1] {
		case "CanPowerOff":
			return []byte(`s "challenge"`), nil
		case "CanSuspend":
			return []byte(`s "na"`), nil
		case "CanReboot":
			return []byte(`s "yes"`), nil
		}
		return nil, errors.New("unexpected")
	}}
	info, err := a.Inspect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info.Hostname == "" || info.BootID == "" || info.Mode != "direct" || len(info.Actions) != 3 {
		t.Fatal(info)
	}
	for _, action := range info.Actions {
		if action.Available != (action.ID == "reboot") {
			t.Fatal(action)
		}
	}
	if len(calls) != 3 || !strings.HasPrefix(calls[0], "/usr/bin/busctl --system --timeout=2 call org.freedesktop.login1 ") {
		t.Fatal(calls)
	}
	calls = nil
	if err := a.Execute(context.Background(), "poweroff; id"); err == nil || len(calls) > 0 {
		t.Fatal("arbitrary command accepted")
	}
}
func TestRestrictedHelperAndDirectDispatch(t *testing.T) {
	for _, trusted := range []bool{true, false} {
		var calls []string
		a := &Adapter{trusted: func() bool { return trusted }, run: func(_ context.Context, exe string, args ...string) ([]byte, error) {
			calls = append(calls, exe+" "+strings.Join(args, " "))
			return nil, nil
		}}
		if err := a.Execute(context.Background(), "reboot"); err != nil {
			t.Fatal(err)
		}
		expected := "/usr/bin/systemctl --no-ask-password --check-inhibitors=yes --no-block reboot"
		if trusted {
			expected = "/usr/bin/sudo -n -- /usr/local/libexec/coreops-power reboot"
		}
		if len(calls) != 1 || calls[0] != expected {
			t.Fatal(calls)
		}
	}
}
func TestMalformedHelperStatusFallsBackWithoutEnablingUnknown(t *testing.T) {
	a := &Adapter{trusted: func() bool { return true }, run: func(_ context.Context, exe string, args ...string) ([]byte, error) {
		if exe == "/usr/bin/sudo" {
			return []byte(`{"protocol":99,"states":{"reboot":"yes"}}`), nil
		}
		return []byte(`unexpected output`), nil
	}}
	info, err := a.Inspect(context.Background())
	if err != nil || info.Mode != "direct" {
		t.Fatal(info, err)
	}
	for _, action := range info.Actions {
		if action.Available {
			t.Fatal("unknown capability enabled", action)
		}
	}
}
func TestCommandCancellationAndOutputLimit(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := run(ctx, "/usr/bin/true"); err == nil {
		t.Fatal("cancelled command ran")
	}
	var b bounded
	if _, err := b.Write(make([]byte, 8193)); err == nil {
		t.Fatal("unbounded output")
	}
}
