package security

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fixture struct {
	probes     map[string]string
	errs       map[string]error
	sessions   []Session
	state      SourceStatus
	sessionErr error
	signalled  int
	enabled    int
	cap        Capability
}

func (f *fixture) Probe(_ context.Context, op string) (string, error) {
	return f.probes[op], f.errs[op]
}
func (f *fixture) Sessions(context.Context) ([]Session, SourceStatus, error) {
	return f.sessions, f.state, f.sessionErr
}
func (f *fixture) Signal(_ context.Context, s Session) error { f.signalled = s.PID; return nil }
func (f *fixture) EnableAutoUpdates(context.Context) error {
	f.enabled++
	f.probes["upgrade-timer"] = "LoadState=loaded\nActiveState=active\nUnitFileState=enabled"
	return nil
}
func (f *fixture) CanEnableAutoUpdates(context.Context) Capability { return f.cap }
func TestUnknownEvidenceNeverPasses(t *testing.T) {
	denied := &SourceError{State: "permission_denied", Detail: "permission denied"}
	f := &fixture{errs: map[string]error{}, state: SourceStatus{State: "permission_denied"}, sessionErr: denied}
	for _, op := range []string{"ufw", "ufw-version", "sshd", "fail2ban", "apt-policy", "upgrade-timer", "ports", "events"} {
		f.errs[op] = denied
	}
	o, e := New(f).Overview(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if o.FirewallActive != nil {
		t.Fatal("invented firewall state")
	}
	for _, c := range o.Checks {
		if c.OK != nil {
			t.Fatalf("check %s invented state", c.ID)
		}
	}
	if o.Sources["events"].State != "permission_denied" || o.Sources["sessions"].State != "permission_denied" {
		t.Fatal(o.Sources)
	}
}
func TestSSHPolicyAndAPTChecks(t *testing.T) {
	config := "passwordauthentication no\nkbdinteractiveauthentication no\npubkeyauthentication yes\ngssapiauthentication no\nhostbasedauthentication no\npermitrootlogin prohibit-password"
	key, root := SSHChecks(config, nil)
	if key.OK == nil || !*key.OK || root.OK == nil || *root.OK {
		t.Fatal(key, root)
	}
	key, _ = SSHChecks(strings.Replace(config, "kbdinteractiveauthentication no", "kbdinteractiveauthentication yes", 1), nil)
	if key.OK == nil || *key.OK {
		t.Fatal("interactive auth marked key-only")
	}
	key, _ = SSHChecks("passwordauthentication no", nil)
	if key.OK != nil {
		t.Fatal("incomplete ssh config marked known")
	}
	apt := "APT::Periodic::Update-Package-Lists \"1\";\nAPT::Periodic::Unattended-Upgrade \"1\";"
	timer := "LoadState=loaded\nActiveState=active\nUnitFileState=enabled"
	c := AutoUpdates(apt, timer, nil, nil)
	if c.OK == nil || !*c.OK {
		t.Fatal(c)
	}
	for _, changed := range []string{"ActiveState=inactive", "UnitFileState=enabled-runtime"} {
		parts := strings.Split(changed, "=")
		bad := strings.Replace(timer, parts[0]+"="+map[string]string{"ActiveState": "active", "UnitFileState": "enabled"}[parts[0]], changed, 1)
		c = AutoUpdates(apt, bad, nil, nil)
		if c.OK == nil || *c.OK {
			t.Fatal(c)
		}
	}
	c = AutoUpdates(apt+"\nAPT::Periodic::Enable \"0\";", timer, nil, nil)
	if c.OK == nil || *c.OK {
		t.Fatal(c)
	}
}
func TestOnlyFreshVerifiedSessionCanBeSignalled(t *testing.T) {
	id := strings.Repeat("a", 64)
	f := &fixture{sessions: []Session{{ID: id, PID: 12345, Verified: true, CanTerminate: true}}, state: SourceStatus{State: "ok"}}
	s := New(f)
	for _, tc := range []struct {
		pid  int
		id   string
		want error
	}{{1, id, ErrInvalid}, {2026, id, ErrNotFound}, {12345, strings.Repeat("b", 64), ErrConflict}, {12345, "", ErrInvalid}} {
		if _, err := s.Terminate(context.Background(), tc.pid, tc.id); !errors.Is(err, tc.want) {
			t.Fatal(tc, err)
		}
	}
	if f.signalled != 0 {
		t.Fatal("signal on rejected request")
	}
	f.sessions[0].Verified = false
	if _, e := s.Terminate(context.Background(), 12345, id); !errors.Is(e, ErrPermission) {
		t.Fatal(e)
	}
	f.sessions[0].Verified = true
	f.sessions[0].CanTerminate = false
	if _, e := s.Terminate(context.Background(), 12345, id); !errors.Is(e, ErrPermission) {
		t.Fatal(e)
	}
	f.sessions[0].CanTerminate = true
	f.state.State = "unavailable"
	if _, e := s.Terminate(context.Background(), 12345, id); !errors.Is(e, ErrUnavailable) {
		t.Fatal(e)
	}
	f.state.State = "ok"
	if _, e := s.Terminate(context.Background(), 12345, id); e != nil || f.signalled != 12345 {
		t.Fatal(e)
	}
}
func TestAutoUpdatesReadbackAndLeastPrivilege(t *testing.T) {
	f := &fixture{probes: map[string]string{"apt-policy": "APT::Periodic::Update-Package-Lists \"1\";\nAPT::Periodic::Unattended-Upgrade \"1\";", "upgrade-timer": "LoadState=loaded\nActiveState=inactive\nUnitFileState=disabled"}}
	s := New(f)
	if e := s.EnableAutoUpdates(context.Background()); !errors.Is(e, ErrPermission) || f.enabled != 0 {
		t.Fatal(e)
	}
	f.cap.Available = true
	if e := s.EnableAutoUpdates(context.Background()); e != nil || f.enabled != 1 {
		t.Fatal(e)
	}
	if e := s.EnableAutoUpdates(context.Background()); e != nil || f.enabled != 1 {
		t.Fatal("idempotent state was mutated", e)
	}
	f.probes["apt-policy"] = "APT::Periodic::Enable \"0\";"
	if e := s.EnableAutoUpdates(context.Background()); !errors.Is(e, ErrConflict) || f.enabled != 1 {
		t.Fatal(e)
	}
}
func TestUFWAndJournalParsing(t *testing.T) {
	rules := ParseRules("[ 1] 22/tcp (v6) ALLOW IN Anywhere (v6) # SSH\n443/tcp ALLOW Anywhere")
	if len(rules) != 2 || rules[0].To != "22/tcp (v6)" || rules[0].Action != "ALLOW IN" || rules[0].Comment != "SSH" {
		t.Fatal(rules)
	}
	if _, ok := Firewall("ERROR permission denied"); ok {
		t.Fatal("error recognized as live status")
	}
	f := &fixture{state: SourceStatus{State: "ok"}, probes: map[string]string{"events": `{"__REALTIME_TIMESTAMP":"1794820000000000","MESSAGE":"Accepted publickey"}`}}
	o, e := New(f).Overview(context.Background())
	if e != nil || len(o.Events) != 1 || o.Events[0].Type != "success" || o.Events[0].Timestamp == "" {
		t.Fatal(o.Events, e)
	}
}

func TestMalformedJournalRecordsAreReported(t *testing.T) {
	f := &fixture{state: SourceStatus{State: "ok"}, probes: map[string]string{"events": "not JSON"}}
	o, e := New(f).Overview(context.Background())
	if e != nil || o.Sources["events"].State != "partial" || len(o.Events) != 0 {
		t.Fatal(o, e)
	}
}
func TestAPTFalsyGlobalPolicy(t *testing.T) {
	apt := "APT::Periodic::Enable \"false\";\nAPT::Periodic::Update-Package-Lists \"1\";\nAPT::Periodic::Unattended-Upgrade \"1\";"
	c := AutoUpdates(apt, "LoadState=loaded\nActiveState=active\nUnitFileState=enabled", nil, nil)
	if c.OK == nil || *c.OK {
		t.Fatal(c)
	}
}
