package tailscalelocal

import (
	"context"
	"encoding/json"
	"errors"
	core "github.com/ppdev28/CoreOps/backend/internal/tailscale"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripper func(*http.Request) (*http.Response, error)

func (f roundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(code int, body string) *http.Response {
	return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}
func adapterFor(handler func(*http.Request) (*http.Response, error)) *Adapter {
	return &Adapter{client: &http.Client{Transport: roundTripper(handler)}, trusted: func() bool { return false }, identity: func() (string, string) { return "owned-host", "boot-one" }}
}

const statusJSON = `{"Version":"1.104.7","BackendState":"Running","TailscaleIPs":["100.64.0.1"],"Self":{"ID":"node-one","DNSName":"host.test.ts.net.","Online":true,"PublicKey":"do-not-expose"},"Peer":{"pubkey-one":{"ID":"peer-one","HostName":"Peer","DNSName":"peer.test.ts.net.","TailscaleIPs":["100.64.0.2"],"Online":false}},"CurrentTailnet":{"Name":"test-tailnet"},"Health":[],"AuthURL":"javascript:alert(1)"}`
const prefsJSON = `{"Hostname":"","WantRunning":true,"CorpDNS":true,"RouteAll":false,"RunSSH":true,"ShieldsUp":false,"ControlURL":"https://controlplane.tailscale.com","Persist":{"PrivateNodeKey":"private-key-never-export"}}`

func TestOverviewAllowlistUnknownFieldsAndReadOnlyPermissionProbe(t *testing.T) {
	var calls []string
	a := adapterFor(func(r *http.Request) (*http.Response, error) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		switch r.URL.Path {
		case "/localapi/v0/status":
			return response(200, statusJSON), nil
		case "/localapi/v0/prefs":
			return response(200, prefsJSON), nil
		case "/localapi/v0/check-prefs":
			body, _ := io.ReadAll(r.Body)
			if string(body) != "{}" {
				t.Error("probe contained settings")
			}
			return response(403, "denied"), nil
		}
		t.Fatal("unexpected request")
		return nil, nil
	})
	s, err := a.Inspect(context.Background())
	if err != nil || !s.Available || s.Permission.Available || len(s.Peers) != 1 || s.SignInURL != "" || s.Revision == "" {
		t.Fatal(s, err)
	}
	if s.Preferences.SSH == nil || !*s.Preferences.SSH || s.Peers[0].Online == nil || *s.Peers[0].Online {
		t.Fatal(s)
	}
	body, _ := json.Marshal(s)
	for _, secret := range []string{"do-not-expose", "private-key-never-export", "Persist", "PublicKey", "javascript:"} {
		if strings.Contains(string(body), secret) {
			t.Fatal("raw daemon data exposed", secret)
		}
	}
	if len(calls) != 3 {
		t.Fatal(calls)
	}
}
func TestOnlyMaskedPreferencesAreWritten(t *testing.T) {
	v := false
	host := "new-name"
	var sent map[string]any
	a := adapterFor(func(r *http.Request) (*http.Response, error) {
		if r.Method != "PATCH" || r.URL.Path != "/localapi/v0/prefs" {
			t.Fatal(r.Method, r.URL.Path)
		}
		json.NewDecoder(r.Body).Decode(&sent)
		return response(200, prefsJSON), nil
	})
	if err := a.Apply(context.Background(), "configure", core.Changes{AcceptDNS: &v, Hostname: &host}, "direct"); err != nil {
		t.Fatal(err)
	}
	if len(sent) != 4 || sent["CorpDNS"] != false || sent["CorpDNSSet"] != true || sent["Hostname"] != "new-name" || sent["HostnameSet"] != true {
		t.Fatal(sent)
	}
	for _, action := range []string{"operator", "serve", "logout", "reset"} {
		if err := a.Apply(context.Background(), action, core.Changes{}, "direct"); !errors.Is(err, core.ErrInvalid) {
			t.Fatal(action, err)
		}
	}
}
func TestPermissionHelperAndUnavailablePreferences(t *testing.T) {
	a := adapterFor(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/localapi/v0/status":
			return response(200, statusJSON), nil
		case "/localapi/v0/prefs":
			return response(200, prefsJSON), nil
		default:
			return response(403, "permission denied"), nil
		}
	})
	a.trusted = func() bool { return true }
	var command string
	a.helper = func(_ context.Context, action string, body []byte) ([]byte, error) {
		command = action
		if action == "check" {
			return []byte(`{"protocol":1,"ready":true}`), nil
		}
		var input struct {
			Action  string
			Changes core.Changes
		}
		if json.Unmarshal(body, &input) != nil || input.Action != "disconnect" {
			t.Fatal("helper got wrong payload")
		}
		return []byte(`{"protocol":1,"accepted":true}`), nil
	}
	s, err := a.Inspect(context.Background())
	if err != nil || s.Permission.Mode != "helper" || !s.Permission.Available {
		t.Fatal(s, err)
	}
	if err := a.Apply(context.Background(), "disconnect", core.Changes{}, "helper"); err != nil || command != "apply" {
		t.Fatal(err)
	}
	a = adapterFor(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/localapi/v0/status" {
			return response(200, statusJSON), nil
		}
		return response(403, "secret diagnostics must not be exposed"), nil
	})
	s, err = a.Inspect(context.Background())
	if err != nil || !s.Available || s.Preferences != nil || s.Permission.Available {
		t.Fatal(s, err)
	}
	a = adapterFor(func(*http.Request) (*http.Response, error) {
		return response(200, strings.Repeat("x", responseLimit+1)), nil
	})
	s, _ = a.Inspect(context.Background())
	if s.Available {
		t.Fatal("oversize data accepted")
	}
}
func TestLoginURLsAndFlowAreConstrained(t *testing.T) {
	for _, raw := range []string{"javascript:alert(1)", "http://login.tailscale.com/a/secret", "https://login.tailscale.com.evil.invalid/a/secret", "https://user:pass@login.tailscale.com/a/secret", "https://evil.invalid/a/secret"} {
		if signInURL(raw, "https://controlplane.tailscale.com") != "" {
			t.Fatal("unsafe link accepted", raw)
		}
	}
	for _, raw := range []string{"https://login.tailscale.com/a/secret", "https://headscale.test:8443/register/secret"} {
		control := "https://headscale.test:8443"
		if signInURL(raw, control) != raw {
			t.Fatal("valid link rejected")
		}
	}
	var calls []string
	a := adapterFor(func(r *http.Request) (*http.Response, error) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		return response(200, "{}"), nil
	})
	if err := a.Apply(context.Background(), "login", core.Changes{}, "direct"); err != nil {
		t.Fatal(err)
	}
	if strings.Join(calls, ",") != "POST /localapi/v0/start,PATCH /localapi/v0/prefs,POST /localapi/v0/login-interactive" {
		t.Fatal(calls)
	}
}

func TestStaleLoginURLIsHiddenAndIncompletePrefsCannotWrite(t *testing.T) {
	for _, state := range []string{"Running", "NeedsLogin"} {
		body := strings.Replace(statusJSON, "javascript:alert(1)", "https://login.tailscale.com/a/test-only", 1)
		body = strings.Replace(body, `"BackendState":"Running"`, `"BackendState":"`+state+`"`, 1)
		a := adapterFor(func(r *http.Request) (*http.Response, error) {
			if strings.HasSuffix(r.URL.Path, "status") {
				return response(200, body), nil
			}
			if strings.HasSuffix(r.URL.Path, "prefs") && !strings.HasSuffix(r.URL.Path, "check-prefs") {
				return response(200, prefsJSON), nil
			}
			return response(200, "{}"), nil
		})
		s, err := a.Inspect(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if (s.SignInURL != "") != (state == "NeedsLogin") {
			t.Fatal("login URL exposed in wrong state", state)
		}
	}
	a := adapterFor(func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "status") {
			return response(200, statusJSON), nil
		}
		return response(200, "{}"), nil
	})
	s, _ := a.Inspect(context.Background())
	if s.Permission.Available {
		t.Fatal("unknown connection preferences permitted changes")
	}
}
