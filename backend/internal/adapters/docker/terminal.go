package docker

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/moby/moby/client"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
)

type TerminalClient interface {
	ContainerInspect(context.Context, string, client.ContainerInspectOptions) (client.ContainerInspectResult, error)
	ExecCreate(context.Context, string, client.ExecCreateOptions) (client.ExecCreateResult, error)
	ExecAttach(context.Context, string, client.ExecAttachOptions) (client.ExecAttachResult, error)
	ExecResize(context.Context, string, client.ExecResizeOptions) (client.ExecResizeResult, error)
	ExecInspect(context.Context, string, client.ExecInspectOptions) (client.ExecInspectResult, error)
}
type ContainerTerminal struct{ client TerminalClient }

func NewTerminal(c TerminalClient) *ContainerTerminal { return &ContainerTerminal{client: c} }
func (a *ContainerTerminal) inspect(ctx context.Context, id string) (containers.TerminalInfo, error) {
	if a.client == nil {
		return containers.TerminalInfo{}, containers.ErrTerminalUnavailable
	}
	result, err := a.client.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return containers.TerminalInfo{}, classify(err)
	}
	c := result.Container
	if c.State == nil || !c.State.Running || c.State.Paused || c.State.Restarting || c.State.Dead {
		return containers.TerminalInfo{}, containers.ErrTerminalStopped
	}
	if c.Config == nil {
		return containers.TerminalInfo{}, containers.ErrTerminalUnavailable
	}
	info := containers.TerminalInfo{Host: strings.TrimPrefix(c.Name, "/"), Shell: "/bin/sh"}
	if c.Config != nil {
		info.User = c.Config.User
		if c.Config.Hostname != "" {
			info.Host = c.Config.Hostname
		}
	}
	if info.User == "" {
		info.User = "0"
	} // Docker's actual default, not the CoreOps account.
	return info, nil
}
func (a *ContainerTerminal) CheckTerminal(ctx context.Context, id string) error {
	_, err := a.inspect(ctx, id)
	return err
}
func (a *ContainerTerminal) OpenTerminal(ctx context.Context, id string, cols, rows uint16) (containers.TerminalSession, error) {
	setup, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	info, err := a.inspect(setup, id)
	if err != nil {
		return nil, err
	}
	size := client.ConsoleSize{Width: uint(cols), Height: uint(rows)}
	created, err := a.client.ExecCreate(setup, id, client.ExecCreateOptions{Cmd: []string{"/bin/sh", "-i"}, TTY: true, ConsoleSize: size, AttachStdin: true, AttachStdout: true, AttachStderr: true, Env: []string{"TERM=xterm-256color", "COLORTERM=truecolor"}})
	if err != nil {
		return nil, classify(err)
	}
	attached, err := a.client.ExecAttach(setup, created.ID, client.ExecAttachOptions{TTY: true, ConsoleSize: size})
	if err != nil {
		return nil, errors.Join(containers.ErrTerminalUnavailable, err)
	}
	return &dockerTerminal{client: a.client, id: created.ID, attached: attached, info: info}, nil
}

type dockerTerminal struct {
	client   TerminalClient
	id       string
	attached client.ExecAttachResult
	info     containers.TerminalInfo
}

func (s *dockerTerminal) Read(p []byte) (int, error)    { return s.attached.Reader.Read(p) }
func (s *dockerTerminal) Write(p []byte) (int, error)   { return s.attached.Conn.Write(p) }
func (s *dockerTerminal) Close() error                  { s.attached.Close(); return nil }
func (s *dockerTerminal) Info() containers.TerminalInfo { return s.info }
func (s *dockerTerminal) Resize(ctx context.Context, cols, rows uint16) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_, err := s.client.ExecResize(ctx, s.id, client.ExecResizeOptions{Width: uint(cols), Height: uint(rows)})
	return err
}
func (s *dockerTerminal) Wait(ctx context.Context) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	for {
		result, err := s.client.ExecInspect(ctx, s.id, client.ExecInspectOptions{})
		if err != nil {
			return -1, err
		}
		if !result.Running {
			return result.ExitCode, nil
		}
		select {
		case <-ctx.Done():
			return -1, errors.New("container exec exit status unavailable")
		case <-time.After(50 * time.Millisecond):
		}
	}
}
