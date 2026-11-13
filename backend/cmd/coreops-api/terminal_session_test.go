package main

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type terminalHarness struct {
	server   *httptest.Server
	terminal *terminalServer
	auth     *AuthStore
}

func newTerminalHarness(t *testing.T) *terminalHarness {
	t.Helper()
	// Tests exercise a real PTY without loading or writing the host user's shell files.
	shell := filepath.Join(t.TempDir(), "shell")
	if err := os.WriteFile(shell, []byte("#!/bin/sh\nexport HISTFILE=/dev/null\nexport PS1='coreops-test> '\nexec /bin/bash --noprofile --norc -i\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("COREOPS_TERMINAL_SHELL", shell)
	auth := newTestStore(t)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleAdmin} {
		auth.users[string(role)] = User{Name: string(role), Role: role}
		auth.sessions[tokenKey(string(role))] = session{User: string(role), Expires: time.Now().Add(time.Hour)}
	}
	api := &API{}
	audit := NewAuditLog(auth.dir)
	server := httptest.NewServer(withCORS(withLogging(withAudit(audit, api.routes(auth, audit)))))
	h := &terminalHarness{server, api.terminals, auth}
	t.Cleanup(func() { h.terminal.Close(); server.Close() })
	return h
}
func (h *terminalHarness) connect(t *testing.T, token string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(h.server.URL, "http")+"/api/v1/terminal/session", http.Header{"Origin": {h.server.URL}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	if err := conn.WriteJSON(terminalClientMessage{Type: "auth", Token: token, Cols: 80, Rows: 24}); err != nil {
		t.Fatal(err)
	}
	return conn
}
func readTerminalUntil(t *testing.T, conn *websocket.Conn, expected string) string {
	t.Helper()
	var output strings.Builder
	_ = conn.SetReadDeadline(time.Now().Add(8 * time.Second))
	for {
		kind, bytes, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("waiting for %q: %v; received %q", expected, err, output.String())
		}
		if kind == websocket.BinaryMessage {
			_ = conn.WriteJSON(terminalClientMessage{Type: "ack"})
		}
		output.Write(bytes)
		if strings.Contains(output.String(), expected) {
			return output.String()
		}
	}
}
func sendTerminal(t *testing.T, conn *websocket.Conn, value string) {
	t.Helper()
	if err := conn.WriteMessage(websocket.BinaryMessage, []byte(value)); err != nil {
		t.Fatal(err)
	}
}
func TestTerminalRealPTY(t *testing.T) {
	h := newTerminalHarness(t)
	t.Setenv("COREOPS_TEST_SECRET", "must-not-inherit")
	c := h.connect(t, "admin")
	readTerminalUntil(t, c, `"type":"ready"`)
	sendTerminal(t, c, "export COREOPS_PTY_VALUE=persistent; cd /tmp; test -t 0 && test -t 1 && printf '\\n%s:%s:%s\\n' \"$COREOPS_PTY_VALUE\" \"$PWD\" \"${COREOPS_TEST_SECRET-unset}\"\r")
	readTerminalUntil(t, c, "persistent:/tmp:unset")
	sendTerminal(t, c, "printf '\\n%s\\n' \"$COREOPS_PTY_VALUE\"\r")
	readTerminalUntil(t, c, "\r\npersistent\r\n")
	if err := c.WriteJSON(terminalClientMessage{Type: "resize", Cols: 101, Rows: 37}); err != nil {
		t.Fatal(err)
	}
	sendTerminal(t, c, "stty size\r")
	readTerminalUntil(t, c, "37 101")
	// A real terminal's line discipline delivers SIGINT to the foreground job.
	sendTerminal(t, c, "sh -c 'printf job-%s ready; exec sleep 60'\r")
	readTerminalUntil(t, c, "job-ready")
	sendTerminal(t, c, "\x03")
	readTerminalUntil(t, c, "coreops-test> ")
	sendTerminal(t, c, "printf '\\n%s\\n' survived-interrupt\r")
	readTerminalUntil(t, c, "\r\nsurvived-interrupt\r\n")
	// Password-style input must not be echoed back to the browser.
	sendTerminal(t, c, "stty -echo; printf 'password-%s' ready; read -r secret; stty echo; printf '\\n%s\\n' hidden-input-done\r")
	readTerminalUntil(t, c, "password-ready")
	sendTerminal(t, c, "not-a-real-password\r")
	output := readTerminalUntil(t, c, "\r\nhidden-input-done\r\n")
	if strings.Contains(output, "not-a-real-password") {
		t.Fatal("hidden input was echoed")
	}
	sendTerminal(t, c, "exit 7\r")
	readTerminalUntil(t, c, `"code":7`)
	h.terminal.Close()
	rows, err := h.terminal.audit.Tail(100)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(rows)
	for _, secret := range []string{"not-a-real-password", "COREOPS_PTY_VALUE", "must-not-inherit"} {
		if strings.Contains(string(data), secret) {
			t.Fatal("terminal data leaked into audit")
		}
	}
}

func expectTerminalClosed(t *testing.T, c *websocket.Conn) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(4 * time.Second))
	for {
		_, _, err := c.ReadMessage()
		if err != nil {
			if e, ok := err.(net.Error); ok && e.Timeout() {
				t.Fatal("terminal was not closed")
			}
			return
		}
	}
}
func TestTerminalAuthorizationAndOrigin(t *testing.T) {
	h := newTerminalHarness(t)
	for _, origin := range []string{"https://evil.example", "", h.server.URL + ".evil.example"} {
		c, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(h.server.URL, "http")+"/api/v1/terminal/session", http.Header{"Origin": {origin}})
		if c != nil {
			c.Close()
		}
		if err == nil || response.StatusCode != http.StatusForbidden {
			t.Fatalf("accepted origin %q", origin)
		}
		response.Body.Close()
	}
	for _, token := range []string{"viewer", "operator", "invalid"} {
		c := h.connect(t, token)
		readTerminalUntil(t, c, "Administrator session required")
		c.Close()
	}
	h.auth.mu.Lock()
	h.auth.sessions[tokenKey("expired")] = session{User: "admin", Expires: time.Now().Add(-time.Second)}
	h.auth.mu.Unlock()
	c := h.connect(t, "expired")
	readTerminalUntil(t, c, "Administrator session required")
}
func TestTerminalRevocationAndLimits(t *testing.T) {
	h := newTerminalHarness(t)
	connections := make([]*websocket.Conn, 4)
	for i := range connections {
		connections[i] = h.connect(t, "admin")
		readTerminalUntil(t, connections[i], `"type":"ready"`)
	}
	fifth := h.connect(t, "admin")
	readTerminalUntil(t, fifth, "Maximum of four")
	h.auth.Logout("admin")
	for _, c := range connections {
		expectTerminalClosed(t, c)
	}
	// Tokens, commands and terminal data never enter lifecycle audit records.
	rows, err := h.terminal.audit.Tail(100)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(rows)
	if strings.Contains(string(data), "must-not-inherit") {
		t.Fatal("secret in audit")
	}
}
func TestTerminalFlowControlAndShutdown(t *testing.T) {
	h := newTerminalHarness(t)
	c := h.connect(t, "admin")
	readTerminalUntil(t, c, `"type":"ready"`)
	sendTerminal(t, c, "yes\r")
	// Pause rendering ACKs; input must still reach the foreground job.
	time.Sleep(150 * time.Millisecond)
	sendTerminal(t, c, "\x03")
	readTerminalUntil(t, c, "coreops-test> ")
	sendTerminal(t, c, "printf '\\n%s\\n' flow-control-survived\r")
	readTerminalUntil(t, c, "\r\nflow-control-survived\r\n")
	h.terminal.Close()
	expectTerminalClosed(t, c)
}

func TestTerminalActiveExpiryAndOversizedInput(t *testing.T) {
	h := newTerminalHarness(t)
	c := h.connect(t, "admin")
	readTerminalUntil(t, c, `"type":"ready"`)
	h.auth.mu.Lock()
	h.auth.sessions[tokenKey("admin")] = session{User: "admin", Expires: time.Now().Add(-time.Second)}
	h.auth.mu.Unlock()
	expectTerminalClosed(t, c)
	h.auth.mu.Lock()
	h.auth.sessions[tokenKey("admin")] = session{User: "admin", Expires: time.Now().Add(time.Hour)}
	h.auth.mu.Unlock()
	c = h.connect(t, "admin")
	readTerminalUntil(t, c, `"type":"ready"`)
	sendTerminal(t, c, strings.Repeat("x", 32769))
	expectTerminalClosed(t, c)
}

func TestTerminalCapabilityRequiresAdmin(t *testing.T) {
	h := newTerminalHarness(t)
	for _, test := range []struct {
		token  string
		status int
	}{
		{"", 401}, {"viewer", 403}, {"operator", 403}, {"admin", 200},
	} {
		req, _ := http.NewRequest(http.MethodGet, h.server.URL+"/api/v1/terminal/session", nil)
		if test.token != "" {
			req.Header.Set("Authorization", "Bearer "+test.token)
		}
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != test.status {
			t.Fatalf("token %q: got %d, want %d", test.token, response.StatusCode, test.status)
		}
		if test.status == 200 {
			var body struct {
				Available bool
				Protocol  int
			}
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil || !body.Available || body.Protocol != 1 {
				t.Fatalf("invalid capability: %+v, %v", body, err)
			}
		}
		response.Body.Close()
	}
	if len(h.terminal.users) != 0 || len(h.terminal.slots) != 0 {
		t.Fatal("capability probe started a session")
	}
}

func TestTerminalDelayedShellStartup(t *testing.T) {
	h := newTerminalHarness(t)
	shell := filepath.Join(t.TempDir(), "slow-shell")
	if err := os.WriteFile(shell, []byte("#!/bin/sh\nsleep 2\nexport HISTFILE=/dev/null\nexport PS1='delayed-shell-ready> '\nexec /bin/bash --noprofile --norc -i\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("COREOPS_TERMINAL_SHELL", shell)
	c := h.connect(t, "admin")
	readTerminalUntil(t, c, `"type":"ready"`)
	readTerminalUntil(t, c, "delayed-shell-ready> ")
	sendTerminal(t, c, "printf '\\n%s\\n' startup-survived\r")
	readTerminalUntil(t, c, "\r\nstartup-survived\r\n")
}
