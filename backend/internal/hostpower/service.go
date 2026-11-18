package hostpower

import (
	"context"
	"errors"
	"regexp"
	"sync"
	"time"
)

var (
	ErrInvalid     = errors.New("invalid power action or request identifier")
	ErrTarget      = errors.New("host identity changed or confirmation does not match; reopen the control center")
	ErrUnavailable = errors.New("this power action is unavailable or requires host administrator setup")
	ErrBusy        = errors.New("a power request was recently submitted; verify the host before another request")
)

type Action struct {
	ID        string `json:"id"`
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}
type Info struct {
	Hostname string   `json:"hostname"`
	BootID   string   `json:"bootId"`
	Mode     string   `json:"mode"`
	Actions  []Action `json:"actions"`
}
type Request struct {
	Action    string `json:"action"`
	Hostname  string `json:"hostname"`
	BootID    string `json:"bootId"`
	RequestID string `json:"requestId"`
}
type Result struct {
	Accepted  bool   `json:"accepted"`
	Action    string `json:"action"`
	RequestID string `json:"requestId"`
}
type Provider interface {
	Inspect(context.Context) (Info, error)
	Execute(context.Context, string) error
}
type record struct {
	request Request
	actor   string
	result  Result
	err     error
	time    time.Time
}
type Service struct {
	provider Provider
	mu       sync.Mutex
	records  map[string]record
	last     time.Time
}

func New(provider Provider) *Service {
	return &Service{provider: provider, records: map[string]record{}}
}
func ValidAction(action string) bool {
	return action == "poweroff" || action == "reboot" || action == "suspend"
}

var requestPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

func (s *Service) Inspect(ctx context.Context) (Info, error) { return s.provider.Inspect(ctx) }
func (s *Service) Submit(ctx context.Context, r Request, actor string, beforeExecute func() error) (Result, error) {
	if !ValidAction(r.Action) || !requestPattern.MatchString(r.RequestID) || actor == "" {
		return Result{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for key, value := range s.records {
		if now.Sub(value.time) > 5*time.Minute {
			delete(s.records, key)
		}
	}
	if old, ok := s.records[r.RequestID]; ok {
		if old.request != r || old.actor != actor {
			return Result{}, ErrTarget
		}
		return old.result, old.err
	}
	if now.Sub(s.last) < 10*time.Second || len(s.records) >= 64 {
		return Result{}, ErrBusy
	}
	info, err := s.provider.Inspect(ctx)
	if err != nil {
		return Result{}, err
	}
	if info.Hostname == "" || info.BootID == "" || r.Hostname != info.Hostname || r.BootID != info.BootID {
		return Result{}, ErrTarget
	}
	available := false
	for _, action := range info.Actions {
		if action.ID == r.Action {
			available = action.Available
		}
	}
	if !available {
		return Result{}, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if beforeExecute != nil {
		if err := beforeExecute(); err != nil {
			return Result{}, err
		}
	}
	s.last = time.Now()
	err = s.provider.Execute(ctx, r.Action)
	result := Result{Accepted: err == nil, Action: r.Action, RequestID: r.RequestID}
	// Retain failures too: a lost reply must not silently execute the same action twice.
	s.records[r.RequestID] = record{request: r, actor: actor, result: result, err: err, time: time.Now()}
	return result, err
}
