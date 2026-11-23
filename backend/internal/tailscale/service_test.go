package tailscale

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func ptr[T any](v T) *T { return &v }

type providerFixture struct {
	snapshot Snapshot
	calls    int
	fail     error
}

func (f *providerFixture) Inspect(context.Context) (Snapshot, error) { return f.snapshot, nil }
func (f *providerFixture) Apply(context.Context, string, Changes, string) error {
	f.calls++
	return f.fail
}
func fixture() *providerFixture {
	s := Snapshot{Available: true, State: "Running", Hostname: "owned-host", BootID: "boot-one", NodeID: "node-one", Permission: Permission{Available: true, Mode: "direct"}, Preferences: &Preferences{Hostname: ptr(""), WantRunning: ptr(true), AcceptDNS: ptr(true), AcceptRoutes: ptr(false), SSH: ptr(true), ShieldsUp: ptr(false)}}
	s.Revision = Revision(s, "https://controlplane.tailscale.com")
	return &providerFixture{snapshot: s}
}
func req(s Snapshot) Request {
	return Request{Action: "configure", Hostname: s.Hostname, Revision: s.Revision, RequestID: strings.Repeat("a", 32), Changes: Changes{AcceptDNS: ptr(false)}}
}
func TestTargetsPermissionsStateAndAuditGuard(t *testing.T) {
	for _, kind := range []string{"host", "revision", "permission", "unavailable", "unknown-preference", "auth", "audit", "cancelled", "invalid-hostname", "injected-action", "connect-while-running", "login-while-running"} {
		t.Run(kind, func(t *testing.T) {
			f := fixture()
			s := New(f)
			r := req(f.snapshot)
			var guard func() error
			ctx := context.Background()
			want := ErrChanged
			switch kind {
			case "host":
				r.Hostname = "other-host"
			case "revision":
				r.Revision = strings.Repeat("b", 64)
			case "permission":
				f.snapshot.Permission.Available = false
				want = ErrUnavailable
			case "unavailable":
				f.snapshot.Available = false
				want = ErrUnavailable
			case "unknown-preference":
				f.snapshot.Preferences.AcceptDNS = nil
				want = ErrUnavailable
			case "auth", "audit":
				want = errors.New("guard failed")
				guard = func() error { return want }
			case "cancelled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
				want = context.Canceled
			case "invalid-hostname":
				r.Changes.Hostname = ptr("host;reboot")
				want = ErrInvalid
			case "injected-action":
				r.Action = "logout"
				want = ErrInvalid
			case "connect-while-running":
				r.Action = "connect"
				r.Changes = Changes{}
				want = ErrUnavailable
			case "login-while-running":
				r.Action = "login"
				r.Changes = Changes{}
				want = ErrUnavailable
			}
			if _, err := s.Submit(ctx, r, "actor", guard); !errors.Is(err, want) {
				t.Fatal(kind, err, want)
			}
			if f.calls != 0 {
				t.Fatal("rejected action reached daemon")
			}
		})
	}
}
func TestReplayUsesValuesAndCachesUncertainOutcome(t *testing.T) {
	for _, fail := range []error{nil, errors.New("reply lost")} {
		f := fixture()
		f.fail = fail
		s := New(f)
		r := req(f.snapshot)
		result, err := s.Submit(context.Background(), r, "actor", nil)
		if !errors.Is(err, fail) || result.Accepted != (fail == nil) {
			t.Fatal(result, err)
		}
		copy := req(f.snapshot)
		if _, err = s.Submit(context.Background(), copy, "actor", nil); !errors.Is(err, fail) {
			t.Fatal(err)
		}
		if f.calls != 1 {
			t.Fatal("identical JSON values were submitted twice")
		}
		if _, err = s.Submit(context.Background(), copy, "different actor", nil); !errors.Is(err, ErrChanged) {
			t.Fatal(err)
		}
		copy.RequestID = strings.Repeat("b", 32)
		if _, err = s.Submit(context.Background(), copy, "actor", nil); !errors.Is(err, ErrBusy) {
			t.Fatal(err)
		}
	}
}
func TestOnlyOneConcurrentDispatchAndRevisionIgnoresPeers(t *testing.T) {
	f := fixture()
	s := New(f)
	s.mu.Lock()
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if _, err := s.Submit(context.Background(), req(f.snapshot), "actor", nil); !errors.Is(err, ErrBusy) {
			t.Error(err)
		}
	}()
	wg.Wait()
	s.mu.Unlock()
	before := Revision(f.snapshot, "https://controlplane.tailscale.com")
	f.snapshot.Peers = []Peer{{Name: "changes constantly"}}
	f.snapshot.Health = []string{"different warning"}
	f.snapshot.SignInURL = "https://login.tailscale.com/a/secret"
	if before != Revision(f.snapshot, "https://controlplane.tailscale.com") {
		t.Fatal("volatile data changed revision")
	}
	f.snapshot.Preferences.SSH = ptr(false)
	if before == Revision(f.snapshot, "https://controlplane.tailscale.com") {
		t.Fatal("preference change did not invalidate revision")
	}
	s.last = time.Now().Add(-time.Minute)
}
func TestValidatedConnectDisconnectAndLogin(t *testing.T) {
	for _, action := range []string{"connect", "disconnect", "login"} {
		f := fixture()
		r := req(f.snapshot)
		r.Action = action
		r.Changes = Changes{}
		switch action {
		case "connect":
			f.snapshot.State = "Stopped"
			f.snapshot.Preferences.WantRunning = ptr(false)
		case "login":
			f.snapshot.State = "NeedsLogin"
			f.snapshot.NodeID = ""
		}
		f.snapshot.Revision = Revision(f.snapshot, "")
		r.Revision = f.snapshot.Revision
		if result, err := New(f).Submit(context.Background(), r, "actor", nil); err != nil || !result.Accepted || f.calls != 1 {
			t.Fatal(action, result, err)
		}
	}
}
