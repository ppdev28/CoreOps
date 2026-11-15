package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/moby/moby/client"
)

const createdContainerID = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

type createDockerFixture struct {
	mu                        sync.Mutex
	calls                     []string
	config                    map[string]any
	name                      string
	createStatus, startStatus int
}

func (f *createDockerFixture) snapshot() ([]string, map[string]any, string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string{}, f.calls...), f.config, f.name
}

func createHarness(t *testing.T, fixture *createDockerFixture) (http.Handler, *AuthStore, *AuditLog) {
	t.Helper()
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fixture.mu.Lock()
		defer fixture.mu.Unlock()
		fixture.calls = append(fixture.calls, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1.52/containers/create":
			fixture.name = r.URL.Query().Get("name")
			if err := json.NewDecoder(r.Body).Decode(&fixture.config); err != nil {
				t.Error(err)
			}
			if fixture.createStatus != 0 {
				w.WriteHeader(fixture.createStatus)
				_ = json.NewEncoder(w).Encode(map[string]string{"message": "upstream-secret-do-not-expose"})
				return
			}
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(map[string]any{"Id": createdContainerID, "Warnings": []string{"fixture warning"}})
		case "/v1.52/containers/" + createdContainerID + "/start":
			if fixture.startStatus != 0 {
				w.WriteHeader(fixture.startStatus)
				_, _ = w.Write([]byte(`{"message":"port allocation failed; upstream-secret-do-not-expose"}`))
			} else {
				w.WriteHeader(204)
			}
		default:
			t.Errorf("unexpected engine request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	t.Cleanup(engine.Close)
	docker, err := client.NewClientWithOpts(client.WithHost("tcp://"+engine.Listener.Addr().String()), client.WithVersion("1.52"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = docker.Close() })
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
	audit := NewAuditLog(store.dir)
	api := &API{docker: docker}
	handler := withAudit(audit, api.routes(store, audit))
	t.Cleanup(api.terminals.Close)
	return handler, store, audit
}

func createRequest(handler http.Handler, token, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/containers", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestCreateContainerPermissionsAndRevocation(t *testing.T) {
	fixture := &createDockerFixture{}
	handler, store, audit := createHarness(t, fixture)
	for token, status := range map[string]int{"": 401, "viewer": 403, "operator": 403} {
		if response := createRequest(handler, token, `{"name":"test","image":"nginx:stable"}`); response.Code != status {
			t.Fatalf("%q: %d", token, response.Code)
		}
	}
	cli, err := NewAuthStore(store.dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if err := cli.RemoveUser("admin"); err != nil {
		t.Fatal(err)
	}
	if response := createRequest(handler, "admin", `{"name":"test","image":"nginx:stable"}`); response.Code != 401 {
		t.Fatal("externally revoked admin can create")
	}
	calls, _, _ := fixture.snapshot()
	if len(calls) != 0 {
		t.Fatal("unauthorized Docker request", calls)
	}
	rows, err := audit.Tail(10)
	if err != nil || len(rows) != 4 {
		t.Fatalf("missing denial audit: %v %v", rows, err)
	}
}

func TestCreateContainerValidationBeforeDocker(t *testing.T) {
	fixture := &createDockerFixture{}
	handler, _, _ := createHarness(t, fixture)
	cases := []string{
		`{}`, `null`, `{"name":"../test","image":"nginx"}`,
		`{"name":"test","image":""}`, `{"name":"test","image":"nginx latest"}`,
		`{"name":"test","image":"nginx","privileged":true}`,
		`{"name":"test","image":"nginx","mounts":["/:/host"]}`,
		`{"name":"test","image":"nginx","restartPolicy":"invalid"}`,
		`{"name":"test","image":"nginx","environment":["TOKEN=secret","TOKEN=other"]}`,
		`{"name":"test","image":"nginx","environment":["NOT_A_PAIR"]}`,
		`{"name":"test","image":"nginx","ports":[{"hostPort":70000,"containerPort":80}]}`,
		`{"name":"test","image":"nginx","ports":[{"hostPort":8080,"containerPort":80,"hostIp":"invalid"}]}`,
		`{"name":"test","image":"nginx","ports":[{"hostPort":8080,"containerPort":80,"protocol":"sctp"}]}`,
		`{"name":"test","image":"nginx","ports":[{"hostPort":8080,"containerPort":80},{"hostPort":8080,"containerPort":81}]}`,
		`{"name":"test","image":"nginx","command":["\u0000"]}`,
		`{"name":"test","image":"nginx"} {}`,
		`{"name":"test","image":"nginx","environment":["A=` + strings.Repeat("x", 65536) + `"]}`,
	}
	for index, body := range cases {
		if response := createRequest(handler, "admin", body); response.Code != 400 {
			t.Errorf("case %d: %d %s", index, response.Code, response.Body.String())
		}
	}
	calls, _, _ := fixture.snapshot()
	if len(calls) != 0 {
		t.Fatal("invalid input reached Docker", calls)
	}
}

func TestCreateContainerConfigurationAndSafeDefaults(t *testing.T) {
	fixture := &createDockerFixture{}
	handler, store, _ := createHarness(t, fixture)
	response := createRequest(handler, "admin", `{"name":"my-service","image":"nginx:stable","environment":["TOKEN=private-test-value"],"command":["nginx","-g","daemon off;"],"ports":[{"hostPort":18080,"containerPort":80}]}`)
	if response.Code != 201 {
		t.Fatalf("%d %s", response.Code, response.Body.String())
	}
	var result CreateContainerResponse
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.ID != createdContainerID || result.Started || len(result.Warnings) != 1 || response.Header().Get("Location") != "/api/v1/containers/"+createdContainerID {
		t.Fatalf("wrong result: %+v", result)
	}
	calls, config, name := fixture.snapshot()
	if len(calls) != 1 || name != "my-service" || config["Image"] != "nginx:stable" {
		t.Fatalf("wrong Docker request: %v %v", calls, config)
	}
	host := config["HostConfig"].(map[string]any)
	if host["Privileged"] == true || host["PublishAllPorts"] == true || host["NetworkMode"] != "bridge" || host["Binds"] != nil {
		t.Fatalf("unsafe defaults: %v", host)
	}
	bindings := host["PortBindings"].(map[string]any)["80/tcp"].([]any)
	if bindings[0].(map[string]any)["HostIp"] != "127.0.0.1" {
		t.Fatal("port published on all interfaces")
	}
	if host["RestartPolicy"].(map[string]any)["Name"] != "no" {
		t.Fatal("automatic restart enabled")
	}
	audit, err := os.ReadFile(filepath.Join(store.dir, auditFileName))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(audit, []byte("private-test-value")) || bytes.Contains(response.Body.Bytes(), []byte("private-test-value")) {
		t.Fatal("environment leaked")
	}
	if !bytes.Contains(audit, []byte(createdContainerID)) {
		t.Fatal("missing created ID in audit")
	}
}

func TestCreateContainerEngineFailuresAndPartialStart(t *testing.T) {
	for _, tc := range []struct {
		name                                string
		createStatus, startStatus, expected int
		started                             bool
	}{
		{"conflict", 409, 0, 409, false}, {"image missing", 404, 0, 422, false},
		{"invalid config", 400, 0, 400, false}, {"daemon failed", 500, 0, 502, false},
		{"created and started", 0, 0, 201, true}, {"created but start failed", 0, 500, 201, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := &createDockerFixture{createStatus: tc.createStatus, startStatus: tc.startStatus}
			handler, _, _ := createHarness(t, fixture)
			response := createRequest(handler, "admin", `{"name":"my-service","image":"nginx:stable","start":true}`)
			if response.Code != tc.expected {
				t.Fatalf("%d %s", response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "upstream-secret") {
				t.Fatal("engine detail leaked")
			}
			if tc.createStatus == 0 {
				var result CreateContainerResponse
				_ = json.Unmarshal(response.Body.Bytes(), &result)
				if result.ID != createdContainerID || result.Started != tc.started || (tc.startStatus != 0 && result.StartError == "") {
					t.Fatalf("partial result lost: %+v", result)
				}
				calls, _, _ := fixture.snapshot()
				if len(calls) != 2 {
					t.Fatalf("unexpected retries/rollback: %v", calls)
				}
			}
		})
	}
}
