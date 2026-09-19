package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

const (
	terminalSessionTTL = 30 * time.Second
	terminalPendingMax = 512 * 1024
)

type terminalSession struct {
	id             string
	cmd            *exec.Cmd
	pty            *os.File
	mu             sync.Mutex
	connMu         sync.Mutex
	conn           *websocket.Conn
	disconnectedAt time.Time
	pendingOutput  []byte
	closed         bool
}

type terminalManager struct {
	mu       sync.Mutex
	sessions map[string]*terminalSession
}

type terminalClientMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

var terminalSessions = &terminalManager{sessions: make(map[string]*terminalSession)}

var terminalUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 16384,
	CheckOrigin: func(r *http.Request) bool {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			return false
		}

		// Explicit configuration always wins and supports multiple frontend origins.
		if allowed := os.Getenv("SCP_WEB_ORIGIN"); allowed != "" {
			for _, candidate := range strings.Split(allowed, ",") {
				if strings.TrimSpace(candidate) == origin {
					return true
				}
			}
			return false
		}

		// CoreOps is commonly reached through the Vite reverse proxy on a LAN or
		// Tailscale address. The backend sees the proxy's Host, while the browser's
		// Origin remains the real frontend origin. When a browser supplies Referer,
		// require it to resolve to that same origin.
		referer := strings.TrimSpace(r.Header.Get("Referer"))
		if referer == "" {
			return false
		}
		u, err := url.Parse(referer)
		if err != nil || u.Scheme == "" || u.Host == "" {
			return false
		}
		return u.Scheme + "://" + u.Host == origin
	},
}

func (a *API) terminalWebSocket(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimSpace(r.URL.Query().Get("sessionId"))
	session, err := terminalSessions.getOrCreate(sessionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	conn, err := terminalUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	if err := session.attach(conn); err != nil {
		_ = conn.WriteJSON(map[string]any{"type": "error", "message": err.Error()})
		_ = conn.Close()
		return
	}

	defer session.detach(conn)
	if err := session.writeJSON(map[string]any{
		"type":      "ready",
		"sessionId": session.id,
		"shell":     session.cmd.Path,
	}); err != nil {
		return
	}

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}

		var message terminalClientMessage
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}

		switch message.Type {
		case "input":
			if err := session.writePTY([]byte(message.Data)); err != nil {
				return
			}
		case "resize":
			if message.Cols == 0 || message.Rows == 0 {
				continue
			}
			_ = pty.Setsize(session.pty, &pty.Winsize{Cols: message.Cols, Rows: message.Rows})
		case "close":
			session.close()
			return
		case "ping":
			_ = session.writeJSON(map[string]any{"type": "pong"})
		}
	}
}

func (m *terminalManager) getOrCreate(id string) (*terminalSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupLocked()

	if id != "" {
		if session, ok := m.sessions[id]; ok && !session.isClosed() {
			return session, nil
		}
	}

	session, err := newTerminalSession()
	if err != nil {
		return nil, err
	}
	m.sessions[session.id] = session
	return session, nil
}

func (m *terminalManager) cleanupLocked() {
	now := time.Now()
	for id, session := range m.sessions {
		if session.expired(now) {
			session.close()
			delete(m.sessions, id)
		}
	}
}

func newTerminalSession() (*terminalSession, error) {
	shell := strings.TrimSpace(os.Getenv("SHELL"))
	if shell == "" {
		shell = "/bin/bash"
	}
	resolved, err := exec.LookPath(shell)
	if err != nil {
		for _, candidate := range []string{"/bin/bash", "/bin/zsh", "/bin/sh"} {
			if resolved, err = exec.LookPath(candidate); err == nil {
				shell = resolved
				break
			}
		}
		if err != nil {
			return nil, fmt.Errorf("no usable shell found: %w", err)
		}
	} else {
		shell = resolved
	}

	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = os.Getenv("HOME")
	}
	if home == "" {
		return nil, errors.New("unable to determine terminal home directory")
	}

	cmd := exec.Command(shell, "-l")
	cmd.Dir = home
	cmd.Env = terminalEnvironment(home, shell)

	file, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 120, Rows: 32})
	if err != nil {
		return nil, fmt.Errorf("start terminal shell: %w", err)
	}

	id, err := randomTerminalID()
	if err != nil {
		_ = file.Close()
		_ = cmd.Process.Kill()
		return nil, err
	}

	session := &terminalSession{id: id, cmd: cmd, pty: file}
	go session.readOutput()
	go func() {
		_ = cmd.Wait()
		session.mu.Lock()
		session.closed = true
		session.mu.Unlock()
	}()
	return session, nil
}

func terminalEnvironment(home, shell string) []string {
	env := os.Environ()
	env = append(env, "TERM=xterm-256color", "COLORTERM=truecolor", "SHELL="+shell, "HOME="+home)
	if os.Getenv("LANG") == "" {
		env = append(env, "LANG=C.UTF-8")
	}
	return env
}

func randomTerminalID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func (s *terminalSession) attach(conn *websocket.Conn) error {
	s.connMu.Lock()
	defer s.connMu.Unlock()
	if s.isClosed() {
		return errors.New("terminal session has exited")
	}
	if s.conn != nil {
		return errors.New("terminal session is already connected")
	}
	s.conn = conn
	s.mu.Lock()
	s.disconnectedAt = time.Time{}
	pending := append([]byte(nil), s.pendingOutput...)
	s.pendingOutput = nil
	s.mu.Unlock()
	if len(pending) > 0 {
		if err := conn.WriteMessage(websocket.BinaryMessage, pending); err != nil {
			s.conn = nil
			return err
		}
	}
	return nil
}

func (s *terminalSession) detach(conn *websocket.Conn) {
	s.connMu.Lock()
	defer s.connMu.Unlock()
	if s.conn == conn {
		s.conn = nil
		s.mu.Lock()
		s.disconnectedAt = time.Now()
		s.mu.Unlock()
	}
}

func (s *terminalSession) writePTY(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("terminal session has exited")
	}
	_, err := s.pty.Write(data)
	return err
}

func (s *terminalSession) readOutput() {
	buffer := make([]byte, 32*1024)
	for {
		n, err := s.pty.Read(buffer)
		if n > 0 {
			_ = s.writeOutput(buffer[:n])
		}
		if err != nil {
			return
		}
	}
}

func (s *terminalSession) writeOutput(data []byte) error {
	s.connMu.Lock()
	defer s.connMu.Unlock()
	if s.conn == nil {
		s.mu.Lock()
		s.pendingOutput = append(s.pendingOutput, data...)
		if len(s.pendingOutput) > terminalPendingMax {
			s.pendingOutput = append([]byte(nil), s.pendingOutput[len(s.pendingOutput)-terminalPendingMax:]...)
		}
		s.mu.Unlock()
		return nil
	}
	return s.conn.WriteMessage(websocket.BinaryMessage, data)
}

func (s *terminalSession) writeJSON(value any) error {
	s.connMu.Lock()
	defer s.connMu.Unlock()
	if s.conn == nil {
		return errors.New("terminal websocket is disconnected")
	}
	return s.conn.WriteJSON(value)
}

func (s *terminalSession) isClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

func (s *terminalSession) expired(now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.closed && s.conn == nil && !s.disconnectedAt.IsZero() && now.Sub(s.disconnectedAt) > terminalSessionTTL
}

func (s *terminalSession) close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	process := s.cmd.Process
	file := s.pty
	s.mu.Unlock()

	if process != nil {
		_ = process.Signal(syscall.SIGHUP)
		_ = process.Kill()
	}
	if file != nil {
		_ = file.Close()
	}
}
