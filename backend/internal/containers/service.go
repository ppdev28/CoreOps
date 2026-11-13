// Package containers owns container operations independently of HTTP and Docker SDK types.
package containers

import (
	"context"
	"errors"
	"regexp"
)

var (
	ErrInvalidID     = errors.New("invalid container ID")
	ErrInvalidAction = errors.New("invalid container action")
	ErrNotFound      = errors.New("container not found")
)
var idPattern = regexp.MustCompile(`^[a-fA-F0-9]{12,64}$`)

type Port struct {
	PrivatePort uint16
	PublicPort  uint16
	Type        string
	IP          string
}
type Summary struct {
	ID, Name, Image, State, Status string
	CreatedAt                      int64
	Ports                          []Port
	Networks                       []string
}
type Configuration struct {
	Env, Cmd, Entrypoint []string
	WorkingDir           string
}

// Attributes preserves the existing inspect metadata, including unknown keys,
// as owned JSON-compatible values rather than vendor SDK objects.
// Typed models can replace these compatibility fields in later contract slices.
type Attributes = map[string]any

type Detail struct {
	ID, Name, Image, State, Created string
	Config                          Configuration
	RestartPolicy                   string
	Mounts                          []Attributes
	Networks                        map[string]Attributes
	Ports                           map[string][]Attributes
	Labels                          map[string]string
}

type Action string

const (
	Start   Action = "start"
	Stop    Action = "stop"
	Restart Action = "restart"
)

// Runtime is the small port required by this capability; callers do not receive
// access to the general Docker client or privileged host command execution.
type Runtime interface {
	List(context.Context) ([]Summary, error)
	Inspect(context.Context, string) (Detail, error)
	Start(context.Context, string) error
	Stop(context.Context, string) error
	Restart(context.Context, string) error
}

type Service struct{ runtime Runtime }

func New(runtime Runtime) *Service { return &Service{runtime: runtime} }
func (s *Service) List(ctx context.Context) ([]Summary, error) {
	items, err := s.runtime.List(ctx)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []Summary{}
	}
	return items, nil
}

// Inspect retains the existing read-only API's support for IDs and Docker names.
func (s *Service) Inspect(ctx context.Context, reference string) (Detail, error) {
	return s.runtime.Inspect(ctx, reference)
}
func (s *Service) Act(ctx context.Context, id string, action Action) error {
	if !idPattern.MatchString(id) {
		return ErrInvalidID
	}
	switch action {
	case Start:
		return s.runtime.Start(ctx, id)
	case Stop:
		return s.runtime.Stop(ctx, id)
	case Restart:
		return s.runtime.Restart(ctx, id)
	default:
		return ErrInvalidAction
	}
}
