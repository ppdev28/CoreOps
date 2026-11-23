// Package tailscale defines the bounded host management workflow, independent
// of HTTP, Unix sockets and the Tailscale SDK.
package tailscale

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	ErrInvalid     = errors.New("invalid Tailscale action or confirmation")
	ErrChanged     = errors.New("Tailscale state changed; refresh and review the request again")
	ErrUnavailable = errors.New("Tailscale management is not available for this action")
	ErrBusy        = errors.New("a Tailscale request is pending or was recently submitted; refresh status before another request")
)

type Preferences struct {
	Hostname        *string  `json:"hostname"`
	WantRunning     *bool    `json:"wantRunning"`
	AcceptDNS       *bool    `json:"acceptDNS"`
	AcceptRoutes    *bool    `json:"acceptRoutes"`
	SSH             *bool    `json:"ssh"`
	ShieldsUp       *bool    `json:"shieldsUp"`
	ExitNode        string   `json:"exitNode"`
	AdvertiseRoutes []string `json:"advertiseRoutes"`
}
type Permission struct {
	Available bool   `json:"available"`
	Mode      string `json:"mode"`
	Reason    string `json:"reason,omitempty"`
}
type Peer struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	DNSName  string   `json:"dnsName"`
	OS       string   `json:"os"`
	IPs      []string `json:"ips"`
	Online   *bool    `json:"online"`
	Active   *bool    `json:"active"`
	ExitNode bool     `json:"exitNode"`
	LastSeen string   `json:"lastSeen,omitempty"`
}
type Snapshot struct {
	Available      bool         `json:"available"`
	State          string       `json:"state"`
	Version        string       `json:"version"`
	Hostname       string       `json:"hostname"`
	BootID         string       `json:"bootId"`
	NodeID         string       `json:"nodeId"`
	DNSName        string       `json:"dnsName"`
	IPs            []string     `json:"ips"`
	Online         *bool        `json:"online"`
	Tailnet        string       `json:"tailnet"`
	Health         []string     `json:"health"`
	Preferences    *Preferences `json:"preferences"`
	Permission     Permission   `json:"permission"`
	Peers          []Peer       `json:"peers"`
	PeerCount      int          `json:"peerCount"`
	PeersTruncated bool         `json:"peersTruncated"`
	Revision       string       `json:"revision"`
	SignInURL      string       `json:"signInUrl,omitempty"`
	AdminURL       string       `json:"adminUrl,omitempty"`
	Detail         string       `json:"detail,omitempty"`
}
type Changes struct {
	Hostname     *string `json:"hostname,omitempty"`
	AcceptDNS    *bool   `json:"acceptDNS,omitempty"`
	AcceptRoutes *bool   `json:"acceptRoutes,omitempty"`
	SSH          *bool   `json:"ssh,omitempty"`
	ShieldsUp    *bool   `json:"shieldsUp,omitempty"`
}

func (c Changes) Empty() bool {
	return c.Hostname == nil && c.AcceptDNS == nil && c.AcceptRoutes == nil && c.SSH == nil && c.ShieldsUp == nil
}

type Request struct {
	Action    string  `json:"action"`
	Hostname  string  `json:"hostname"`
	Revision  string  `json:"revision"`
	RequestID string  `json:"requestId"`
	Changes   Changes `json:"changes"`
}
type Result struct {
	Accepted  bool   `json:"accepted"`
	Action    string `json:"action"`
	RequestID string `json:"requestId"`
}
type Provider interface {
	Inspect(context.Context) (Snapshot, error)
	Apply(context.Context, string, Changes, string) error
}
type receipt struct {
	fingerprint string
	result      Result
	err         error
	at          time.Time
}
type Service struct {
	provider Provider
	mu       sync.Mutex
	receipts map[string]receipt
	last     time.Time
}

func New(provider Provider) *Service {
	return &Service{provider: provider, receipts: map[string]receipt{}}
}
func (s *Service) Inspect(ctx context.Context) (Snapshot, error) { return s.provider.Inspect(ctx) }

var hostnamePattern = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)
var requestPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var revisionPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func ValidRequest(r Request) bool {
	if !requestPattern.MatchString(r.RequestID) || !revisionPattern.MatchString(r.Revision) || len(r.Hostname) == 0 || len(r.Hostname) > 255 {
		return false
	}
	switch r.Action {
	case "connect", "disconnect", "login":
		return r.Changes.Empty()
	case "configure":
		return !r.Changes.Empty() && (r.Changes.Hostname == nil || *r.Changes.Hostname == "" || hostnamePattern.MatchString(*r.Changes.Hostname))
	}
	return false
}

// Revision deliberately excludes changing peer traffic, health and login URLs.
func Revision(s Snapshot, controlOrigin string) string {
	data, _ := json.Marshal(struct {
		Host, Boot, Node, State, Control string
		Prefs                            *Preferences
	}{s.Hostname, s.BootID, s.NodeID, s.State, controlOrigin, s.Preferences})
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func applicable(s Snapshot, r Request) bool {
	if !s.Available || !s.Permission.Available || s.Hostname == "" || s.BootID == "" || s.Preferences == nil {
		return false
	}
	p := s.Preferences
	if p.WantRunning == nil {
		return false
	}
	switch r.Action {
	case "connect":
		return s.NodeID != "" && s.State == "Stopped" && p.WantRunning != nil && !*p.WantRunning
	case "disconnect":
		return p.WantRunning != nil && *p.WantRunning && (s.State == "Running" || s.State == "Starting")
	case "login":
		return s.State == "NeedsLogin"
	case "configure":
		return s.NodeID != "" && (s.State == "Running" || s.State == "Stopped") && (r.Changes.Hostname == nil || p.Hostname != nil) && (r.Changes.AcceptDNS == nil || p.AcceptDNS != nil) && (r.Changes.AcceptRoutes == nil || p.AcceptRoutes != nil) && (r.Changes.SSH == nil || p.SSH != nil) && (r.Changes.ShieldsUp == nil || p.ShieldsUp != nil)
	}
	return false
}
func (s *Service) Submit(ctx context.Context, r Request, actor string, before func() error) (Result, error) {
	if !ValidRequest(r) || actor == "" {
		return Result{}, ErrInvalid
	}
	if !s.mu.TryLock() {
		return Result{}, ErrBusy
	}
	defer s.mu.Unlock()
	encoded, _ := json.Marshal(r)
	fingerprint := actor + ":" + string(encoded)
	now := time.Now()
	for id, old := range s.receipts {
		if now.Sub(old.at) > 5*time.Minute {
			delete(s.receipts, id)
		}
	}
	if old, ok := s.receipts[r.RequestID]; ok {
		if old.fingerprint != fingerprint {
			return Result{}, ErrChanged
		}
		return old.result, old.err
	}
	if now.Sub(s.last) < 5*time.Second || len(s.receipts) >= 64 {
		return Result{}, ErrBusy
	}
	fresh, err := s.provider.Inspect(ctx)
	if err != nil {
		return Result{}, err
	}
	if r.Revision != fresh.Revision || r.Hostname != fresh.Hostname {
		return Result{}, ErrChanged
	}
	if !applicable(fresh, r) {
		return Result{}, ErrUnavailable
	}
	if err = ctx.Err(); err != nil {
		return Result{}, err
	}
	if before != nil {
		if err = before(); err != nil {
			return Result{}, err
		}
	}
	s.last = time.Now()
	err = s.provider.Apply(ctx, r.Action, r.Changes, fresh.Permission.Mode)
	result := Result{Accepted: err == nil, Action: r.Action, RequestID: r.RequestID}
	s.receipts[r.RequestID] = receipt{fingerprint: strings.Clone(fingerprint), result: result, err: err, at: time.Now()}
	return result, err
}
