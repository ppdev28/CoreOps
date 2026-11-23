// Package tailscalelocal implements a narrow Linux LocalAPI adapter. It never
// proxies browser URLs, returns raw preferences or executes arbitrary commands.
package tailscalelocal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/ppdev28/CoreOps/backend/internal/adapters/helperpath"
	core "github.com/ppdev28/CoreOps/backend/internal/tailscale"
)

const socketPath = "/var/run/tailscale/tailscaled.sock"

var helperPath = helperpath.Path("coreops-tailscale")

const responseLimit = 2 << 20

var errPermission = errors.New("Tailscaled denied access for the API service account")
var errLocalAPI = errors.New("Tailscale local API request failed or returned an unsupported response")

type Adapter struct {
	client   *http.Client
	helper   func(context.Context, string, []byte) ([]byte, error)
	trusted  func() bool
	identity func() (string, string)
}

func New() *Adapter {
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, MaxConnsPerHost: 2, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "unix", socketPath)
	}}
	return &Adapter{client: &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, helper: runHelper, trusted: trustedHelper, identity: hostIdentity}
}
func hostIdentity() (string, string) {
	name, _ := os.Hostname()
	boot, _ := os.ReadFile("/proc/sys/kernel/random/boot_id")
	return name, strings.TrimSpace(string(boot))
}
func trustedHelper() bool {
	for _, path := range []string{filepath.Dir(helperPath), helperPath} {
		info, err := os.Lstat(path)
		if err != nil || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0022 != 0 {
			return false
		}
		owner, ok := info.Sys().(*syscall.Stat_t)
		if !ok || owner.Uid != 0 {
			return false
		}
		if path == helperPath && (!info.Mode().IsRegular() || info.Mode().Perm()&0100 == 0) {
			return false
		}
	}
	return true
}

type outputBuffer struct{ bytes.Buffer }

func (b *outputBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 8192 {
		return 0, errLocalAPI
	}
	return b.Buffer.Write(p)
}
func runHelper(ctx context.Context, action string, input []byte) ([]byte, error) {
	if action != "check" && action != "apply" {
		return nil, core.ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "/usr/bin/sudo", "-n", "--", helperPath, action)
	command.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C", "LC_ALL=C"}
	command.Stdin = bytes.NewReader(input)
	var out outputBuffer
	command.Stdout = &out
	command.Stderr = &out
	err := command.Run()
	return out.Bytes(), err
}
func (a *Adapter) call(ctx context.Context, method, path string, body any) ([]byte, error) {
	allowed := (method == "GET" && (path == "status" || path == "prefs")) || (method == "POST" && (path == "check-prefs" || path == "start" || path == "login-interactive")) || (method == "PATCH" && path == "prefs")
	if !allowed {
		return nil, core.ErrInvalid
	}
	var input io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, errLocalAPI
		}
		input = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://local-tailscaled.sock/localapi/v0/"+path, input)
	if err != nil {
		return nil, errLocalAPI
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, errLocalAPI
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, responseLimit+1))
	if err != nil || len(data) > responseLimit {
		return nil, errLocalAPI
	}
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return nil, errPermission
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, errLocalAPI
	}
	return data, nil
}

type rawNode struct {
	ID           string
	HostName     string
	DNSName      string
	OS           string
	TailscaleIPs []string
	Online       *bool
	Active       *bool
	ExitNode     bool
	LastSeen     time.Time
}
type rawStatus struct {
	Version        string
	BackendState   string
	AuthURL        string
	TailscaleIPs   []string
	Self           *rawNode
	Peer           map[string]rawNode
	Health         []string
	CurrentTailnet *struct{ Name string }
}
type rawPrefs struct {
	Hostname        *string
	WantRunning     *bool
	CorpDNS         *bool
	RouteAll        *bool
	RunSSH          *bool
	ShieldsUp       *bool
	ExitNodeID      string
	ExitNodeIP      string
	AdvertiseRoutes []string
	ControlURL      string
}

func trimmed(s string) string {
	if len(s) > 512 {
		s = s[:512]
	}
	return strings.TrimSpace(s)
}
func origin(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Hostname() == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}
func signInURL(raw, control string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || len(raw) > 2048 {
		return ""
	}
	if (strings.EqualFold(u.Hostname(), "login.tailscale.com") && (u.Port() == "" || u.Port() == "443")) || (origin(raw) != "" && origin(raw) == origin(control)) {
		return raw
	}
	return ""
}
func (a *Adapter) Inspect(ctx context.Context) (core.Snapshot, error) {
	host, boot := a.identity()
	s := core.Snapshot{Hostname: host, BootID: boot, State: "Unavailable", IPs: []string{}, Health: []string{}, Peers: []core.Peer{}, Permission: core.Permission{Reason: "Tailscale state is unavailable."}}
	data, err := a.call(ctx, "GET", "status", nil)
	if err != nil {
		s.Detail = "Cannot read local tailscaled. Check that the daemon is running and the API account can access its Unix socket."
		if errors.Is(err, errPermission) {
			s.Detail = errPermission.Error()
		}
		return s, nil
	}
	var status rawStatus
	if json.Unmarshal(data, &status) != nil || status.BackendState == "" {
		s.Detail = "Tailscaled returned an unsupported status response."
		return s, nil
	}
	s.Available = true
	s.State = trimmed(status.BackendState)
	s.Version = trimmed(status.Version)
	s.IPs = status.TailscaleIPs
	if s.IPs == nil {
		s.IPs = []string{}
	}
	s.Health = status.Health
	if s.Health == nil {
		s.Health = []string{}
	}
	if status.Self != nil {
		s.NodeID = status.Self.ID
		s.DNSName = strings.TrimSuffix(trimmed(status.Self.DNSName), ".")
		s.Online = status.Self.Online
	}
	if status.CurrentTailnet != nil {
		s.Tailnet = trimmed(status.CurrentTailnet.Name)
	}
	s.PeerCount = len(status.Peer)
	for _, peer := range status.Peer {
		p := core.Peer{ID: peer.ID, Name: trimmed(peer.HostName), DNSName: strings.TrimSuffix(trimmed(peer.DNSName), "."), OS: trimmed(peer.OS), IPs: peer.TailscaleIPs, Online: peer.Online, Active: peer.Active, ExitNode: peer.ExitNode}
		if p.IPs == nil {
			p.IPs = []string{}
		}
		if !peer.LastSeen.IsZero() {
			p.LastSeen = peer.LastSeen.UTC().Format(time.RFC3339)
		}
		s.Peers = append(s.Peers, p)
	}
	sort.Slice(s.Peers, func(i, j int) bool {
		a, b := strings.ToLower(s.Peers[i].Name), strings.ToLower(s.Peers[j].Name)
		if a == b {
			return s.Peers[i].ID < s.Peers[j].ID
		}
		return a < b
	})
	if len(s.Peers) > 500 {
		s.Peers = s.Peers[:500]
		s.PeersTruncated = true
	}
	data, err = a.call(ctx, "GET", "prefs", nil)
	if err != nil {
		s.Detail = "Device status is available, but preferences could not be read. Changes are disabled."
		s.Permission.Reason = s.Detail
		return s, nil
	}
	var prefs rawPrefs
	if json.Unmarshal(data, &prefs) != nil {
		s.Detail = "Tailscaled returned unsupported preferences. Changes are disabled."
		s.Permission.Reason = s.Detail
		return s, nil
	}
	exit := prefs.ExitNodeID
	if exit == "" {
		exit = prefs.ExitNodeIP
	}
	s.Preferences = &core.Preferences{Hostname: prefs.Hostname, WantRunning: prefs.WantRunning, AcceptDNS: prefs.CorpDNS, AcceptRoutes: prefs.RouteAll, SSH: prefs.RunSSH, ShieldsUp: prefs.ShieldsUp, ExitNode: exit, AdvertiseRoutes: prefs.AdvertiseRoutes}
	if s.Preferences.AdvertiseRoutes == nil {
		s.Preferences.AdvertiseRoutes = []string{}
	}
	if s.State == "NeedsLogin" {
		s.SignInURL = signInURL(status.AuthURL, prefs.ControlURL)
	}
	if u, e := url.Parse(prefs.ControlURL); e == nil && u.Scheme == "https" && (u.Hostname() == "controlplane.tailscale.com" || u.Hostname() == "login.tailscale.com") {
		s.AdminURL = "https://login.tailscale.com/admin/machines"
	}
	// check-prefs validates without applying changes; it also enforces daemon
	// write permission. A read-only Unix socket is not proof of write access.
	probe, probeErr := a.call(ctx, "POST", "check-prefs", map[string]any{})
	var probeResult map[string]json.RawMessage
	if probeErr == nil && json.Unmarshal(probe, &probeResult) == nil && probeResult != nil {
		s.Permission = core.Permission{Available: true, Mode: "direct"}
	} else {
		s.Permission = core.Permission{Reason: "Tailscaled denies management for the API account. A host administrator can install the restricted CoreOps Tailscale helper."}
		if a.trusted() {
			var ready struct {
				Protocol int  `json:"protocol"`
				Ready    bool `json:"ready"`
			}
			out, e := a.helper(ctx, "check", nil)
			if e == nil && json.Unmarshal(out, &ready) == nil && ready.Protocol == 1 && ready.Ready {
				s.Permission = core.Permission{Available: true, Mode: "helper"}
			}
		}
	}
	if s.Preferences.WantRunning == nil {
		s.Permission = core.Permission{Reason: "The daemon did not report connection preferences; changes are disabled."}
	}
	if host == "" || boot == "" {
		s.Permission = core.Permission{Reason: "Host identity could not be verified; changes are disabled."}
	}
	s.Revision = core.Revision(s, prefs.ControlURL)
	return s, nil
}
func MaskedChanges(action string, c core.Changes) (map[string]any, error) {
	mask := map[string]any{}
	switch action {
	case "connect", "disconnect":
		mask["WantRunning"] = action == "connect"
		mask["WantRunningSet"] = true
	case "configure":
		if c.Hostname != nil {
			mask["Hostname"] = *c.Hostname
			mask["HostnameSet"] = true
		}
		for _, item := range []struct {
			name  string
			value *bool
		}{{"CorpDNS", c.AcceptDNS}, {"RouteAll", c.AcceptRoutes}, {"RunSSH", c.SSH}, {"ShieldsUp", c.ShieldsUp}} {
			if item.value != nil {
				mask[item.name] = *item.value
				mask[item.name+"Set"] = true
			}
		}
		if len(mask) == 0 {
			return nil, core.ErrInvalid
		}
	default:
		return nil, core.ErrInvalid
	}
	return mask, nil
}
func (a *Adapter) Apply(ctx context.Context, action string, changes core.Changes, mode string) error {
	if mode == "helper" {
		if !a.trusted() {
			return errPermission
		}
		data, _ := json.Marshal(struct {
			Action  string       `json:"action"`
			Changes core.Changes `json:"changes"`
		}{action, changes})
		out, err := a.helper(ctx, "apply", data)
		var ack struct {
			Protocol int  `json:"protocol"`
			Accepted bool `json:"accepted"`
		}
		if err != nil || json.Unmarshal(out, &ack) != nil || ack.Protocol != 1 || !ack.Accepted {
			return errLocalAPI
		}
		return nil
	}
	if mode != "direct" {
		return core.ErrUnavailable
	}
	if action == "login" {
		if _, err := a.call(ctx, "POST", "start", map[string]any{}); err != nil {
			return err
		}
		if _, err := a.call(ctx, "PATCH", "prefs", map[string]any{"WantRunning": true, "WantRunningSet": true, "LoggedOut": false, "LoggedOutSet": true}); err != nil {
			return err
		}
		_, err := a.call(ctx, "POST", "login-interactive", map[string]any{})
		return err
	}
	mask, err := MaskedChanges(action, changes)
	if err != nil {
		return err
	}
	_, err = a.call(ctx, "PATCH", "prefs", mask)
	return err
}
