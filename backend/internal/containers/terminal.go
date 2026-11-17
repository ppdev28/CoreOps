package containers

import (
	"context"
	"errors"
	"io"
)

var ErrTerminalStopped = errors.New("container must be running and unpaused to open a terminal")
var ErrTerminalUnavailable = errors.New("container shell unavailable; the image must include /bin/sh")

type TerminalInfo struct {
	User  string `json:"user"`
	Host  string `json:"host"`
	Shell string `json:"shell"`
}

// TerminalSession carries raw TTY bytes, without exposing vendor SDK objects.
// Close releases attachment resources; runtimes define process cleanup semantics.
type TerminalSession interface {
	io.ReadWriteCloser
	Resize(context.Context, uint16, uint16) error
	Wait(context.Context) (int, error)
	Info() TerminalInfo
}
type TerminalRuntime interface {
	CheckTerminal(context.Context, string) error
	OpenTerminal(context.Context, string, uint16, uint16) (TerminalSession, error)
}
type TerminalService struct{ runtime TerminalRuntime }

func NewTerminal(runtime TerminalRuntime) *TerminalService { return &TerminalService{runtime: runtime} }
func (s *TerminalService) Check(ctx context.Context, id string) error {
	if !ValidID(id) {
		return ErrInvalidID
	}
	return s.runtime.CheckTerminal(ctx, id)
}
func (s *TerminalService) Open(ctx context.Context, id string, cols, rows uint16) (TerminalSession, error) {
	if !ValidID(id) || cols < 2 || cols > 500 || rows < 1 || rows > 250 {
		return nil, ErrInvalidID
	}
	return s.runtime.OpenTerminal(ctx, id, cols, rows)
}
