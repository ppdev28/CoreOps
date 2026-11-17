package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
)

type testContainerTerminal struct {
	checks, opens atomic.Int32
	closed        atomic.Bool
	err           error
	resized       chan [2]uint16
}

func (f *testContainerTerminal) CheckTerminal(context.Context, string) error {
	f.checks.Add(1)
	return f.err
}
func (f *testContainerTerminal) OpenTerminal(context.Context, string, uint16, uint16) (containers.TerminalSession, error) {
	f.opens.Add(1)
	a, b := net.Pipe()
	go func() { defer b.Close(); io.Copy(b, b) }()
	return &testContainerSession{Conn: a, owner: f}, nil
}

type testContainerSession struct {
	net.Conn
	owner *testContainerTerminal
}

func (s *testContainerSession) Close() error { s.owner.closed.Store(true); return s.Conn.Close() }
func (s *testContainerSession) Resize(_ context.Context, cols, rows uint16) error {
	s.owner.resized <- [2]uint16{cols, rows}
	return nil
}
func (s *testContainerSession) Wait(context.Context) (int, error) { return 0, nil }
func (s *testContainerSession) Info() containers.TerminalInfo {
	return containers.TerminalInfo{User: "1000", Host: "container", Shell: "/bin/sh"}
}

func TestContainerTerminalAuthStateIORevocationAndAudit(t *testing.T) {
	h := newTerminalHarness(t)
	runtime := &testContainerTerminal{resized: make(chan [2]uint16, 4)}
	h.terminal.containers = containers.NewTerminal(runtime)
	path := "/api/v1/containers/abcdef123456/terminal"
	connect := func(token string) *websocket.Conn {
		c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(h.server.URL, "http")+path, http.Header{"Origin": {h.server.URL}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Close() })
		if err = c.WriteJSON(terminalClientMessage{Type: "auth", Token: token, Cols: 80, Rows: 24}); err != nil {
			t.Fatal(err)
		}
		return c
	}
	for _, token := range []string{"", "viewer", "operator"} {
		c := connect(token)
		readTerminalUntil(t, c, "Administrator session required")
		c.Close()
	}
	if runtime.checks.Load() != 0 || runtime.opens.Load() != 0 {
		t.Fatal("unauthorized runtime access")
	}
	for _, tc := range []struct {
		path, token string
		status      int
	}{
		{path, "", 401}, {path, "operator", 403}, {"/api/v1/containers/invalid/terminal", "admin", 400}, {path + "?token=bad", "admin", 400},
	} {
		req, _ := http.NewRequest("GET", h.server.URL+tc.path, nil)
		req.Header.Set("Authorization", "Bearer "+tc.token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != tc.status {
			t.Fatal(tc, res.StatusCode)
		}
	}
	runtime.err = containers.ErrTerminalStopped
	req, _ := http.NewRequest("GET", h.server.URL+path, nil)
	req.Header.Set("Authorization", "Bearer admin")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 409 {
		t.Fatal(res.StatusCode)
	}
	runtime.err = nil
	c := connect("admin")
	readTerminalUntil(t, c, `"shell":"/bin/sh"`)
	sendTerminal(t, c, "container-input")
	readTerminalUntil(t, c, "container-input")
	c.WriteJSON(terminalClientMessage{Type: "resize", Cols: 120, Rows: 40})
	select {
	case size := <-runtime.resized:
		if size != [2]uint16{120, 40} {
			t.Fatal(size)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no resize")
	}
	if err := h.auth.Logout("admin"); err != nil {
		t.Fatal(err)
	}
	c.SetReadDeadline(time.Now().Add(4 * time.Second))
	if _, _, err := c.ReadMessage(); err == nil {
		t.Fatal("revoked connection still open")
	}
	// A closed socket can be observed before the handler's deferred audit append.
	// Drain the server before asserting the completed lifecycle records.
	h.terminal.Close()
	if !runtime.closed.Load() || runtime.opens.Load() != 1 {
		t.Fatal("attachment not released")
	}
	entries, _ := NewAuditLog(h.auth.dir).Tail(100)
	opened, closed := false, false
	for _, e := range entries {
		if strings.Contains(e.Detail, "container-input") {
			t.Fatal("input in audit")
		}
		if e.Detail == "container abcdef123456: terminal opened" {
			opened = true
		}
		if e.Detail == "container abcdef123456: terminal closed" {
			closed = true
		}
	}
	if !opened || !closed {
		t.Fatal("missing lifecycle audit")
	}
}
