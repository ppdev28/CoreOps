package docker

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/moby/moby/client"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
)

// Use the real SDK wire/hijack path, without touching any Docker resources.
func TestTerminalAdapterTTYDefaultsResizeAndExit(t *testing.T) {
	var mu sync.Mutex
	var created map[string]any
	var resize string
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/containers/abcdef123456/json"):
			io.WriteString(w, `{"Id":"abcdef123456","Name":"/test","State":{"Running":true},"Config":{"User":"1000:1000","Hostname":"test-host"}}`)
		case strings.HasSuffix(r.URL.Path, "/containers/abcdef123456/exec"):
			var input map[string]any
			json.NewDecoder(r.Body).Decode(&input)
			mu.Lock()
			created = input
			mu.Unlock()
			io.WriteString(w, `{"Id":"exec-id"}`)
		case strings.HasSuffix(r.URL.Path, "/exec/exec-id/start"):
			var input map[string]any
			json.NewDecoder(r.Body).Decode(&input)
			if input["Tty"] != true || input["Detach"] == true {
				t.Error(input)
			}
			conn, rw, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			defer conn.Close()
			rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Type: application/vnd.docker.raw-stream\r\n\r\n")
			rw.Flush()
			buffer := make([]byte, 4)
			if _, err := io.ReadFull(rw, buffer); err != nil {
				t.Error(err)
				return
			}
			rw.Write(buffer)
			rw.Flush()
		case strings.HasSuffix(r.URL.Path, "/exec/exec-id/resize"):
			mu.Lock()
			resize = r.URL.RawQuery
			mu.Unlock()
			w.WriteHeader(200)
		case strings.HasSuffix(r.URL.Path, "/exec/exec-id/json"):
			io.WriteString(w, `{"ID":"exec-id","Running":false,"ExitCode":7}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer engine.Close()
	sdk, err := client.NewClientWithOpts(client.WithHost(strings.Replace(engine.URL, "http://", "tcp://", 1)), client.WithVersion("1.52"))
	if err != nil {
		t.Fatal(err)
	}
	defer sdk.Close()
	session, err := NewTerminal(sdk).OpenTerminal(context.Background(), "abcdef123456", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if session.Info().User != "1000:1000" || session.Info().Host != "test-host" {
		t.Fatal(session.Info())
	}
	if _, err = session.Write([]byte("ping")); err != nil {
		t.Fatal(err)
	}
	data := make([]byte, 4)
	if _, err = io.ReadFull(session, data); err != nil || string(data) != "ping" {
		t.Fatal(err, string(data))
	}
	if err = session.Resize(context.Background(), 120, 40); err != nil {
		t.Fatal(err)
	}
	code, err := session.Wait(context.Background())
	if err != nil || code != 7 {
		t.Fatal(code, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if created["Privileged"] == true || (created["User"] != nil && created["User"] != "") || created["Tty"] != true || created["AttachStdin"] != true {
		t.Fatal(created)
	}
	cmd := created["Cmd"].([]any)
	if len(cmd) != 2 || cmd[0] != "/bin/sh" || cmd[1] != "-i" {
		t.Fatal(cmd)
	}
	if resize != "h=40&w=120" {
		t.Fatal(resize)
	}
}

func TestTerminalAdapterRejectsStoppedPausedAndMissing(t *testing.T) {
	for _, state := range []string{`{"Running":false}`, `{"Running":true,"Paused":true}`, `{"Running":true,"Restarting":true}`} {
		engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasSuffix(r.URL.Path, "/json") {
				t.Error("exec attempted for inactive container")
			}
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"State":`+state+`}`)
		}))
		sdk, _ := client.NewClientWithOpts(client.WithHost(strings.Replace(engine.URL, "http://", "tcp://", 1)), client.WithVersion("1.52"))
		if _, err := NewTerminal(sdk).OpenTerminal(context.Background(), "abcdef123456", 80, 24); !errors.Is(err, containers.ErrTerminalStopped) {
			t.Fatal(err)
		}
		sdk.Close()
		engine.Close()
	}
}
