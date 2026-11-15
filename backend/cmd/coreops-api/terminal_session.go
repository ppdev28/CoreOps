package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"golang.org/x/sys/unix"
)

const terminalWindow = 8 // At most 8 × 8 KiB awaiting browser rendering.

type terminalServer struct {
	auth   *AuthStore
	audit  *AuditLog
	ctx    context.Context
	cancel context.CancelFunc
	slots  chan struct{}
	mu     sync.Mutex
	wg     sync.WaitGroup
	users  map[string]int
}

func newTerminalServer(auth *AuthStore, audit *AuditLog) *terminalServer {
	ctx, cancel := context.WithCancel(context.Background())
	return &terminalServer{auth: auth, audit: audit, ctx: ctx, cancel: cancel, slots: make(chan struct{}, 32), users: map[string]int{}}
}

func (s *terminalServer) Close() {
	s.mu.Lock()
	s.cancel()
	s.mu.Unlock()
	s.wg.Wait()
}

// CORS response headers do not protect WebSocket upgrades. Validate an exact
// origin before accepting, including for the Capacitor client. No wildcard hosts.
func terminalOriginAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		return false
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if u.Scheme == scheme && u.Host == r.Host {
		return true
	}
	for _, allowed := range strings.Split("http://localhost:5173,https://localhost,http://localhost,capacitor://localhost,"+envString("COREOPS_CORS_ORIGINS", ""), ",") {
		if origin == strings.TrimSpace(allowed) {
			return true
		}
	}
	return false
}

type terminalClientMessage struct {
	Type  string `json:"type"`
	Token string `json:"token,omitempty"`
	Cols  uint16 `json:"cols,omitempty"`
	Rows  uint16 `json:"rows,omitempty"`
}

func validTerminalSize(cols, rows uint16) bool {
	return cols >= 2 && cols <= 500 && rows >= 1 && rows <= 250
}

func (s *terminalServer) serveHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	if s.ctx.Err() != nil {
		s.mu.Unlock()
		writeError(w, http.StatusServiceUnavailable, errors.New("terminal server is stopping"))
		return
	}
	s.wg.Add(1)
	s.mu.Unlock()
	defer s.wg.Done()
	w.Header().Set("Cache-Control", "no-store")
	// An authenticated capability probe distinguishes an outdated API from a
	// transport failure without starting a process or exposing identity data.
	if !websocket.IsWebSocketUpgrade(r) {
		s.auth.require(RoleAdmin, func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, map[string]any{"available": true, "protocol": 1})
		})(w, r)
		return
	}
	if !terminalOriginAllowed(r) {
		writeError(w, http.StatusForbidden, errors.New("terminal origin is not allowed"))
		return
	}
	select {
	case <-s.ctx.Done():
		writeError(w, http.StatusServiceUnavailable, errors.New("terminal server is stopping"))
		return
	default:
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		writeError(w, http.StatusTooManyRequests, errors.New("terminal connection limit reached"))
		return
	}
	upgrader := websocket.Upgrader{CheckOrigin: terminalOriginAllowed, HandshakeTimeout: 5 * time.Second, ReadBufferSize: 4096, WriteBufferSize: 8192}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	finished := make(chan struct{})
	defer close(finished)
	go func() {
		select {
		case <-s.ctx.Done():
			_ = conn.Close()
		case <-finished:
		}
	}()
	conn.SetReadLimit(32 * 1024)
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var hello terminalClientMessage
	if err := conn.ReadJSON(&hello); err != nil {
		return
	}
	key := tokenKey(hello.Token)
	u, authenticated := s.auth.Authenticate(hello.Token)
	hello.Token = ""
	record := func(detail string, status int) {
		s.audit.Append(AuditEntry{Time: time.Now().UTC(), User: u.Name, Role: u.Role, Method: "GET", Path: r.URL.Path, Remote: remoteHost(r), Status: status, Detail: detail})
	}
	send := func(value any) error {
		_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteJSON(value)
	}
	if hello.Type != "auth" || !authenticated || u.Role != RoleAdmin {
		record("terminal authentication denied", http.StatusForbidden)
		_ = send(map[string]any{"type": "error", "message": "Administrator session required"})
		return
	}
	if !validTerminalSize(hello.Cols, hello.Rows) {
		_ = send(map[string]any{"type": "error", "message": "Invalid terminal size"})
		return
	}
	s.mu.Lock()
	if s.users[u.Name] >= 4 {
		s.mu.Unlock()
		_ = send(map[string]any{"type": "error", "message": "Maximum of four terminals per administrator"})
		return
	}
	s.users[u.Name]++
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.users[u.Name]--; s.mu.Unlock() }()

	cmd, shellUser, err := terminalCommand()
	if err != nil {
		record("terminal shell unavailable", 503)
		_ = send(map[string]any{"type": "error", "message": "Server shell unavailable"})
		return
	}
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: hello.Cols, Rows: hello.Rows})
	if err != nil {
		record("terminal PTY unavailable", 503)
		_ = send(map[string]any{"type": "error", "message": "Unable to start server terminal"})
		return
	}
	// Cache the descriptor: File.Fd() can restore blocking mode. Nonblocking
	// reads allow Close() to interrupt even if a detached child keeps its tty.
	fd := int(ptmx.Fd())
	if err := unix.SetNonblock(fd, true); err != nil {
		_ = cmd.Process.Kill()
		_ = ptmx.Close()
		_ = cmd.Wait()
		_ = send(map[string]any{"type": "error", "message": "Unable to initialize terminal IO"})
		return
	}
	ctx, cancel := context.WithCancel(s.ctx)
	var once sync.Once
	var ptyMu sync.Mutex
	stop := func() {
		once.Do(func() {
			cancel()
			ptyMu.Lock()
			defer ptyMu.Unlock()
			// Interactive programs use a separate foreground process group.
			if fg, err := unix.IoctlGetInt(fd, unix.TIOCGPGRP); err == nil && fg > 0 {
				_ = syscall.Kill(-fg, syscall.SIGKILL)
			}
			_ = cmd.Process.Kill()
			_ = ptmx.Close()
			_ = conn.Close()
		})
	}
	defer stop()
	record("terminal opened", 101)
	defer record("terminal closed", 200)
	wait := make(chan struct{})
	var exitErr error
	go func() { exitErr = cmd.Wait(); close(wait) }()
	// Reap even on disconnect; stop() terminates the shell before this wait.
	defer func() { stop(); <-wait }()
	host, _ := os.Hostname()
	if send(map[string]any{"type": "ready", "user": shellUser, "host": host, "shell": cmd.Path}) != nil {
		return
	}
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	credits := make(chan struct{}, terminalWindow)
	for range terminalWindow {
		credits <- struct{}{}
	}
	go func() {
		defer stop()
		for {
			kind, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			current, valid := s.auth.authenticateKey(key)
			if !valid || current.Role != RoleAdmin {
				return
			}
			if kind == websocket.BinaryMessage {
				if _, err := ptmx.Write(data); err != nil {
					return
				}
				continue
			}
			var msg terminalClientMessage
			if json.Unmarshal(data, &msg) != nil {
				return
			}
			switch msg.Type {
			case "resize":
				if !validTerminalSize(msg.Cols, msg.Rows) {
					return
				}
				ptyMu.Lock()
				err := ctx.Err()
				if err == nil {
					err = unix.IoctlSetWinsize(fd, unix.TIOCSWINSZ, &unix.Winsize{Col: msg.Cols, Row: msg.Rows})
				}
				ptyMu.Unlock()
				if err != nil {
					return
				}
			case "ack":
				select {
				case credits <- struct{}{}:
				default:
				}
			default:
				return
			}
		}
	}()
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		defer stop()
		seconds := 0
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				current, valid := s.auth.authenticateKey(key)
				if !valid || current.Role != RoleAdmin {
					return
				}
				seconds++
				if seconds%20 == 0 && conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(3*time.Second)) != nil {
					return
				}
			}
		}
	}()
	buffer := make([]byte, 8192)
	for {
		select {
		case <-ctx.Done():
			return
		case <-credits:
		}
		n, readErr := ptmx.Read(buffer)
		if n > 0 {
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if conn.WriteMessage(websocket.BinaryMessage, buffer[:n]) != nil {
				return
			}
		}
		if readErr != nil {
			// PTY EOF (EIO on Linux) follows shell exit; retain the exit code.
			select {
			case <-wait:
				code := 0
				if exitErr != nil {
					code = -1
					var e *exec.ExitError
					if errors.As(exitErr, &e) {
						code = e.ExitCode()
					}
				}
				_ = send(map[string]any{"type": "exit", "code": code})
			case <-ctx.Done():
			case <-time.After(time.Second):
			}
			return
		}
	}
}

// Start the service account's interactive login shell in its home directory.
// Do not pass the API's environment (bootstrap credentials, provider tokens) to
// children. This is still a host shell, with all rights of the service account.
func terminalCommand() (*exec.Cmd, string, error) {
	u, err := user.Current()
	if err != nil {
		return nil, "", err
	}
	shell := envString("COREOPS_TERMINAL_SHELL", "/bin/bash")
	if !filepath.IsAbs(shell) {
		return nil, "", fmt.Errorf("shell must be an absolute path")
	}
	cmd := exec.Command(shell, "-l")
	cmd.Dir = u.HomeDir
	cmd.Env = []string{"HOME=" + u.HomeDir, "USER=" + u.Username, "LOGNAME=" + u.Username, "SHELL=" + shell, "TERM=xterm-256color", "COLORTERM=truecolor", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
	for _, name := range []string{"LANG", "LC_ALL", "LC_CTYPE", "TZ"} {
		if value := os.Getenv(name); value != "" {
			cmd.Env = append(cmd.Env, name+"="+value)
		}
	}
	return cmd, u.Username, nil
}
