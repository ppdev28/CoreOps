package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
	"golang.org/x/sys/unix"
)

type hostTerminal struct {
	file    *os.File
	fd      int
	cmd     *exec.Cmd
	info    containers.TerminalInfo
	mu      sync.Mutex
	closed  bool
	wait    chan struct{}
	exitErr error
}

func openHostTerminal(cols, rows uint16) (containers.TerminalSession, error) {
	cmd, user, err := terminalCommand()
	if err != nil {
		return nil, err
	}
	file, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		return nil, err
	}
	fd := int(file.Fd())
	if err = unix.SetNonblock(fd, true); err != nil {
		_ = cmd.Process.Kill()
		file.Close()
		cmd.Wait()
		return nil, err
	}
	host, _ := os.Hostname()
	s := &hostTerminal{file: file, fd: fd, cmd: cmd, wait: make(chan struct{}), info: containers.TerminalInfo{User: user, Host: host, Shell: cmd.Path}}
	go func() { s.exitErr = cmd.Wait(); close(s.wait) }()
	return s, nil
}
func (s *hostTerminal) Read(p []byte) (int, error)    { return s.file.Read(p) }
func (s *hostTerminal) Write(p []byte) (int, error)   { return s.file.Write(p) }
func (s *hostTerminal) Info() containers.TerminalInfo { return s.info }
func (s *hostTerminal) Resize(ctx context.Context, cols, rows uint16) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return os.ErrClosed
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return unix.IoctlSetWinsize(s.fd, unix.TIOCSWINSZ, &unix.Winsize{Col: cols, Row: rows})
}
func (s *hostTerminal) Close() error {
	s.mu.Lock()
	if !s.closed {
		s.closed = true
		if fg, err := unix.IoctlGetInt(s.fd, unix.TIOCGPGRP); err == nil && fg > 0 {
			_ = syscall.Kill(-fg, syscall.SIGKILL)
		}
		_ = s.cmd.Process.Kill()
		_ = s.file.Close()
	}
	s.mu.Unlock()
	<-s.wait
	return nil
}
func (s *hostTerminal) Wait(ctx context.Context) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	select {
	case <-s.wait:
		if s.exitErr == nil {
			return 0, nil
		}
		var e *exec.ExitError
		if errors.As(s.exitErr, &e) {
			return e.ExitCode(), nil
		}
		return -1, s.exitErr
	case <-ctx.Done():
		return -1, ctx.Err()
	}
}
