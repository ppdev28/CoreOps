package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/client"
)

func TestSystemJournalRouteUsesActualTimestampAndPriority(t *testing.T) {
	dir := t.TempDir()
	row := `{"__REALTIME_TIMESTAMP":"1735689600123456","PRIORITY":"4","SYSLOG_IDENTIFIER":"test-unit","MESSAGE":"  preserved  journal text"}`
	if err := os.WriteFile(filepath.Join(dir, "journalctl"), []byte("#!/bin/sh\nprintf '%s\\n' '"+row+"'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	api := &API{}
	r := httptest.NewRequest("GET", "/api/v1/logs?source=system", nil)
	w := httptest.NewRecorder()
	api.logs(w, r)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	var body LogsOverview
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Entries) != 1 || body.Entries[0].Timestamp != "2025-01-01T00:00:00.123456Z" || body.Entries[0].Level != "WARN" || body.Entries[0].Message != "test-unit:   preserved  journal text" {
		t.Fatalf("journal metadata changed: %+v", body)
	}
}

func TestContainerLogsEngineErrorsRemainActionable(t *testing.T) {
	for _, status := range []int{404, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"message":"upstream-private-value"}`))
			}))
			defer engine.Close()
			docker, err := client.NewClientWithOpts(client.WithHost("tcp://"+engine.Listener.Addr().String()), client.WithVersion("1.52"))
			if err != nil {
				t.Fatal(err)
			}
			defer docker.Close()
			api := &API{docker: docker}
			r := httptest.NewRequest("GET", "/", nil)
			r.SetPathValue("id", createdContainerID)
			w := httptest.NewRecorder()
			api.containerLogs(w, r)
			expected := 502
			if status == 404 {
				expected = 404
			}
			if w.Code != expected || strings.Contains(w.Body.String(), "upstream-private") {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
		})
	}
}

func dockerLogFrame(stream byte, text string) []byte {
	frame := make([]byte, 8, 8+len(text))
	frame[0] = stream
	binary.BigEndian.PutUint32(frame[4:], uint32(len(text)))
	return append(frame, text...)
}

func TestDockerLogFramingPreservesStreamsWhitespaceAndTime(t *testing.T) {
	stamp := "2026-11-15T12:34:56.123456789Z"
	data := append(dockerLogFrame(1, stamp+"   indented "), dockerLogFrame(2, stamp+" ERROR failure\n")...)
	data = append(data, dockerLogFrame(1, "message  with  spaces\n")...)
	entries, truncated, err := decodeDockerLogSnapshot(data, "test")
	if err != nil || truncated || len(entries) != 2 {
		t.Fatalf("%+v %v %v", entries, truncated, err)
	}
	if entries[0].Stream != "stderr" || entries[0].Level != "ERROR" || entries[1].Stream != "stdout" || entries[1].Message != "  indented message  with  spaces" || entries[1].Timestamp != stamp {
		t.Fatalf("framing changed actual data: %+v", entries)
	}
	raw, _, err := decodeDockerLogSnapshot([]byte(stamp+" raw TTY\nno timestamp here\n"), "tty")
	if err != nil || len(raw) != 2 || raw[0].Stream != "tty" || raw[1].Timestamp != "" || raw[1].Message != "no timestamp here" {
		t.Fatalf("TTY or unavailable time altered: %+v %v", raw, err)
	}
}

func TestDockerLogBoundsAndStructuredLevel(t *testing.T) {
	entries, cut, err := decodeDockerLogSnapshot(dockerLogFrame(1, strings.Repeat("x", maxLogLine+100)+"\n"), "test")
	if err != nil || !cut || len(entries) != 1 || len(entries[0].Message) != maxLogLine {
		t.Fatalf("long line not bounded: %d %v %v", len(entries), cut, err)
	}
	var data bytes.Buffer
	for index := 0; index < 1500; index++ {
		data.Write(dockerLogFrame(1, fmt.Sprintf("line %d\n", index)))
	}
	entries, cut, err = decodeDockerLogSnapshot(data.Bytes(), "test")
	if err != nil || !cut || len(entries) != 1000 || entries[0].Message != "line 500" || entries[999].Message != "line 1499" {
		t.Fatal("snapshot did not retain bounded latest lines")
	}
	for input, expected := range map[string]string{`{"level":"debug","message":"error is a field value"}`: "DEBUG", `level="warn" message="something happened"`: "WARN", "cherry server started": "INFO", "fatal: startup failed": "ERROR"} {
		if got := inferLogLevel(input); got != expected {
			t.Errorf("%q: %s, want %s", input, got, expected)
		}
	}
	if _, _, err := decodeDockerLogSnapshot(dockerLogFrame(3, "daemon problem"), "test"); err == nil {
		t.Fatal("invalid Docker frame accepted")
	}
	frame := dockerLogFrame(1, "long payload\n")
	if _, cut, err := decodeDockerLogSnapshot(frame[:len(frame)-5], "test"); err != nil || !cut {
		t.Fatal("partial frame not marked as truncated")
	}
}

func TestContainerLogsRoutePolicyAndDockerContract(t *testing.T) {
	var calls atomic.Int32
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "GET" {
			t.Errorf("log read mutated Docker: %s", r.Method)
		}
		switch r.URL.Path {
		case "/v1.52/containers/" + createdContainerID + "/json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"Id":"` + createdContainerID + `","Name":"/actual-container"}`))
		case "/v1.52/containers/" + createdContainerID + "/logs":
			if r.URL.Query().Get("tail") != "100" || r.URL.Query().Get("timestamps") != "1" || r.URL.Query().Get("follow") != "" {
				t.Errorf("wrong bounded snapshot query: %s", r.URL.RawQuery)
			}
			w.Header().Set("Content-Type", "application/vnd.docker.raw-stream")
			_, _ = w.Write(dockerLogFrame(2, "2026-11-15T12:00:00Z WARN real message\n"))
		default:
			t.Errorf("unexpected engine request: %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer engine.Close()
	docker, err := client.NewClientWithOpts(client.WithHost("tcp://"+engine.Listener.Addr().String()), client.WithVersion("1.52"))
	if err != nil {
		t.Fatal(err)
	}
	defer docker.Close()
	store := newTestStore(t)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleAdmin} {
		store.users[string(role)] = User{Name: string(role), Role: role}
		store.sessions[tokenKey(string(role))] = session{User: string(role), Expires: time.Now().Add(time.Hour)}
	}
	if err := store.save(usersFileName, store.users); err != nil {
		t.Fatal(err)
	}
	if err := store.save(sessionsFileName, store.sessions); err != nil {
		t.Fatal(err)
	}
	api := &API{docker: docker}
	handler := api.routes(store, NewAuditLog(store.dir))
	defer api.terminals.Close()
	request := func(token, target string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", target, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	target := "/api/v1/containers/" + createdContainerID + "/logs?tail=100"
	for token, status := range map[string]int{"": 401, "viewer": 403} {
		if got := request(token, target); got.Code != status {
			t.Fatalf("%q: %d", token, got.Code)
		}
	}
	for _, suffix := range []string{"tail=0", "tail=1001", "tail=abc"} {
		if got := request("operator", "/api/v1/containers/"+createdContainerID+"/logs?"+suffix); got.Code != 400 {
			t.Fatal("bad tail accepted", got.Code)
		}
	}
	if got := request("operator", "/api/v1/containers/not-an-id/logs"); got.Code != 400 {
		t.Fatal("bad ID accepted", got.Code)
	}
	if calls.Load() != 0 {
		t.Fatal("denied/invalid logs request reached Docker")
	}
	for _, role := range []string{"operator", "admin"} {
		response := request(role, target)
		if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: %d %s", role, response.Code, response.Body.String())
		}
		var body LogsOverview
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if len(body.Entries) != 1 || body.Entries[0].Source != "actual-container" || body.Entries[0].Stream != "stderr" || body.Entries[0].Message != "WARN real message" {
			t.Fatalf("bad logs DTO: %+v", body)
		}
	}
	cli, err := NewAuthStore(store.dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if err := cli.RemoveUser("operator"); err != nil {
		t.Fatal(err)
	}
	if response := request("operator", target); response.Code != 401 {
		t.Fatal("revoked operator can read logs")
	}
}
