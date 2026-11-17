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
	"time"

	"github.com/gorilla/websocket"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
)

const terminalWindow = 8 // At most 8 × 8 KiB awaiting browser rendering.

type terminalServer struct {
	auth       *AuthStore
	audit      *AuditLog
	ctx        context.Context
	cancel     context.CancelFunc
	slots      chan struct{}
	mu         sync.Mutex
	wg         sync.WaitGroup
	users      map[string]int
	containers *containers.TerminalService
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
			if err := s.checkTarget(r); err != nil {
				writeError(w, terminalTargetStatus(err), err)
				return
			}
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
		if r.PathValue("id") != "" {
			detail = "container " + r.PathValue("id") + ": " + detail
		}
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

	if err := s.checkTarget(r); err != nil {
		record("terminal target unavailable", terminalTargetStatus(err))
		_ = send(map[string]any{"type": "error", "message": err.Error()})
		return
	}
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	var session containers.TerminalSession
	if id := r.PathValue("id"); id != "" {
		session, err = s.containers.Open(ctx, id, hello.Cols, hello.Rows)
	} else {
		session, err = openHostTerminal(hello.Cols, hello.Rows)
	}
	if err != nil {
		record("terminal shell unavailable", 503)
		message := "Unable to start server terminal"
		if r.PathValue("id") != "" {
			message = "Unable to open container terminal. The container must be running and include /bin/sh."
		}
		_ = send(map[string]any{"type": "error", "message": message})
		return
	}
	var once sync.Once
	stop := func() {
		once.Do(func() {
			cancel()
			_ = session.Close()
			_ = conn.Close()
		})
	}
	defer stop()
	record("terminal opened", 101)
	defer record("terminal closed", 200)
	info := session.Info()
	if send(map[string]any{"type": "ready", "user": info.User, "host": info.Host, "shell": info.Shell}) != nil {
		return
	}
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	credits := make(chan struct{}, terminalWindow)
	for range terminalWindow {
		credits <- struct{}{}
	}
	var workers sync.WaitGroup
	workers.Add(2)
	go func() {
		defer workers.Done()
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
				if _, err := session.Write(data); err != nil {
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
				if err := session.Resize(ctx, msg.Cols, msg.Rows); err != nil {
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
		defer workers.Done()
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
	// Drain auth/input workers before the session handler completes. Otherwise
	// they can touch the identity store after Close() has returned.
	defer func() { stop(); workers.Wait() }()
	buffer := make([]byte, 8192)
	for {
		select {
		case <-ctx.Done():
			return
		case <-credits:
		}
		n, readErr := session.Read(buffer)
		if n > 0 {
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if conn.WriteMessage(websocket.BinaryMessage, buffer[:n]) != nil {
				return
			}
		}
		if readErr != nil {
			if ctx.Err() == nil {
				code, err := session.Wait(ctx)
				if err != nil {
					code = -1
				}
				_ = send(map[string]any{"type": "exit", "code": code})
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

func (s *terminalServer) checkTarget(r *http.Request) error {
	id := r.PathValue("id")
	if id == "" {
		return nil
	}
	if !containers.ValidID(id) || r.URL.RawQuery != "" {
		return containers.ErrInvalidID
	}
	if s.containers == nil {
		return containers.ErrTerminalUnavailable
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	err := s.containers.Check(ctx, id)
	if err == nil || errors.Is(err, containers.ErrNotFound) || errors.Is(err, containers.ErrTerminalStopped) {
		return err
	}
	return containers.ErrTerminalUnavailable
}
func terminalTargetStatus(err error) int {
	switch {
	case errors.Is(err, containers.ErrInvalidID):
		return 400
	case errors.Is(err, containers.ErrNotFound):
		return 404
	case errors.Is(err, containers.ErrTerminalStopped):
		return 409
	default:
		return 503
	}
}
