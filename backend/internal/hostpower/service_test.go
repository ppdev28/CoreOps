package hostpower

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

type fixture struct {
	calls     int
	available bool
	failure   error
}

func (f *fixture) Inspect(context.Context) (Info, error) {
	return Info{Hostname: "owned-test", BootID: "boot-test", Actions: []Action{{ID: "reboot", Available: f.available}}}, nil
}
func (f *fixture) Execute(context.Context, string) error { f.calls++; return f.failure }
func request() Request {
	return Request{Action: "reboot", Hostname: "owned-test", BootID: "boot-test", RequestID: strings.Repeat("a", 32)}
}
func TestConfirmationCapabilitiesAndGuard(t *testing.T) {
	ctx := context.Background()
	for _, kind := range []string{"action", "requestID", "host", "boot", "unavailable", "guard", "cancelled"} {
		t.Run(kind, func(t *testing.T) {
			f := &fixture{available: true}
			s := New(f)
			r := request()
			var guard func() error
			want := ErrInvalid
			testCtx := ctx
			switch kind {
			case "action":
				r.Action = "reboot --force"
			case "requestID":
				r.RequestID = "x"
			case "host":
				r.Hostname = "other"
				want = ErrTarget
			case "boot":
				r.BootID = "old"
				want = ErrTarget
			case "unavailable":
				f.available = false
				want = ErrUnavailable
			case "guard":
				want = errors.New("audit or authorization unavailable")
				guard = func() error { return want }
			case "cancelled":
				c, cancel := context.WithCancel(ctx)
				cancel()
				testCtx = c
				want = context.Canceled
			}
			if _, err := s.Submit(testCtx, r, "actor", guard); !errors.Is(err, want) {
				t.Fatalf("got %v, want %v", err, want)
			}
			if f.calls != 0 {
				t.Fatal("rejected request reached host")
			}
		})
	}
}
func TestConcurrentReplayCooldownAndUncertainOutcome(t *testing.T) {
	for _, failure := range []error{nil, errors.New("lost acknowledgement")} {
		f := &fixture{available: true, failure: failure}
		s := New(f)
		r := request()
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				result, err := s.Submit(context.Background(), r, "actor", nil)
				if !errors.Is(err, failure) || result.Accepted != (failure == nil) {
					t.Errorf("unexpected replay: %+v %v", result, err)
				}
			}()
		}
		wg.Wait()
		if f.calls != 1 {
			t.Fatalf("replay executed %d times", f.calls)
		}
		changed := r
		changed.RequestID = strings.Repeat("b", 32)
		if _, err := s.Submit(context.Background(), changed, "actor", nil); !errors.Is(err, ErrBusy) {
			t.Fatal("cooldown bypassed", err)
		}
		if _, err := s.Submit(context.Background(), r, "other-actor", nil); !errors.Is(err, ErrTarget) {
			t.Fatal("cross-session replay accepted", err)
		}
	}
}
