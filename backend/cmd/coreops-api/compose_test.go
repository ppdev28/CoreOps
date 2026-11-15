package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/moby/moby/client"
)

const composeFixtureYAML = "services:\n  web:\n    image: nginx:alpine\n    environment:\n      TOKEN: fixture-only-secret\n"

func TestComposeDocumentSafety(t *testing.T) {
	cases := map[string]string{
		"include":         "include: /etc/private.yaml\nservices: {web: {image: nginx}}",
		"build":           "services: {web: {image: nginx, build: /}}",
		"env_file":        "services: {web: {image: nginx, env_file: /etc/passwd}}",
		"privileged":      "services: {web: {image: nginx, privileged: true}}",
		"host_network":    "services: {web: {image: nginx, network_mode: host}}",
		"device":          "services: {web: {image: nginx, devices: ['/dev/sda:/dev/sda']}}",
		"bind":            "services: {web: {image: nginx, volumes: ['/:/host']}}",
		"bind_long":       "services: {web: {image: nginx, volumes: [{type: bind, source: /, target: /host}]}}",
		"external":        "services: {web: {image: nginx}}\nvolumes: {data: {external: true}}",
		"volume_driver":   "services: {web: {image: nginx}}\nvolumes: {data: {driver_opts: {device: /}}}",
		"network_driver":  "services: {web: {image: nginx}}\nnetworks: {host: {driver: host}}",
		"env_inherit":     "services: {web: {image: nginx, environment: [HOME]}}",
		"env_null":        "services: {web: {image: nginx, environment: {HOME: null}}}",
		"interpolation":   "services: {web: {image: '${PRIVATE_IMAGE}'}}",
		"reserved_labels": "services: {web: {image: nginx, labels: {'com.docker.compose.project': other}}}",
		"coreops_labels":  "services: {web: {image: nginx, labels: {'io.coreops.compose.deployment': forged}}}",
		"duplicate":       "services:\n  web: {image: nginx}\n  web: {image: redis}\n",
		"documents":       "services: {web: {image: nginx}}\n---\nservices: {other: {image: nginx}}",
		"callback":        "services: {web: {image: nginx, post_start: [{command: touch /host/file}]}}",
		"config":          "services: {web: {image: nginx, configs: [private]}}\nconfigs: {private: {file: /etc/shadow}}",
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := parseComposeDocument(ComposeRequest{Project: "safe-test", Compose: input})
			if err == nil {
				t.Fatal("unsafe Compose accepted")
			}
		})
	}
	valid := "x-defaults: &defaults\n  image: nginx:alpine\nservices:\n  web:\n    <<: *defaults\n    command: [sh, -c, 'echo $$HOSTNAME']\n    volumes: [data:/data]\nvolumes:\n  data:\n"
	model, err := parseComposeDocument(ComposeRequest{Project: "valid-test", Compose: valid})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := model["x-defaults"]; ok {
		t.Fatal("extensions not stripped")
	}
	for _, project := range []string{"../other", "Bad Name", "", strings.Repeat("a", 64), "--flag"} {
		if _, err := parseComposeDocument(ComposeRequest{Project: project, Compose: composeFixtureYAML}); err == nil {
			t.Fatal("unsafe project name accepted", project)
		}
	}
}

type composeFixture struct {
	unlabelledNetwork                                                                                  bool
	mu                                                                                                 sync.Mutex
	calls                                                                                              []string
	owner                                                                                              string
	created, running, existing, networkExists, volumeExists, missingImage, createFailure, startFailure bool
}

func composeHarness(t *testing.T, f *composeFixture) (http.Handler, *composeManager, *AuthStore, *AuditLog) {
	t.Helper()
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.Method != "GET" {
			t.Errorf("SDK should only inspect for Compose creation, got %s", r.Method)
		}
		switch {
		case strings.HasPrefix(r.URL.Path, "/v1.52/images/"):
			if f.missingImage {
				w.WriteHeader(404)
				fmt.Fprintln(w, `{"message":"missing private-image"}`)
				return
			}
			fmt.Fprintln(w, `{"Id":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`)
		case r.URL.Path == "/v1.52/containers/json":
			filters := r.URL.Query().Get("filters")
			if !strings.Contains(filters, "com.docker.compose.project=demo") {
				t.Errorf("missing project filter: %s", filters)
			}
			if !f.created && !f.existing {
				fmt.Fprintln(w, `[]`)
				return
			}
			owner := f.owner
			if f.existing {
				owner = "external"
			}
			state := "created"
			if f.running {
				state = "running"
			}
			_ = json.NewEncoder(w).Encode([]map[string]any{{"Id": createdContainerID, "Names": []string{"/demo-web-1"}, "State": state, "Labels": map[string]string{"com.docker.compose.project": "demo", "com.docker.compose.service": "web", composeOwnerLabel: owner}}})
		case strings.HasPrefix(r.URL.Path, "/v1.52/networks/") || strings.HasPrefix(r.URL.Path, "/v1.52/volumes/"):
			if f.unlabelledNetwork {
				fmt.Fprintln(w, `{"Id":"an-existing-network","Name":"demo_default"}`)
				return
			}
			w.WriteHeader(404)
			fmt.Fprintln(w, `{"message":"not found"}`)
		case r.URL.Path == "/v1.52/networks":
			if f.networkExists {
				fmt.Fprintln(w, `[{"Name":"demo_default"}]`)
			} else {
				fmt.Fprintln(w, `[]`)
			}
		case r.URL.Path == "/v1.52/volumes":
			if f.volumeExists {
				fmt.Fprintln(w, `{"Volumes":[{"Name":"demo_data"}]}`)
			} else {
				fmt.Fprintln(w, `{"Volumes":[]}`)
			}
		default:
			t.Errorf("unexpected Docker request: %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	t.Cleanup(engine.Close)
	docker, err := client.NewClientWithOpts(client.WithHost("tcp://"+engine.Listener.Addr().String()), client.WithVersion("1.52"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { docker.Close() })
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
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	relativeRoot, err := filepath.Rel(cwd, filepath.Join(store.dir, "compose"))
	if err != nil {
		t.Fatal(err)
	}
	manager := newComposeManager(relativeRoot, docker)
	manager.run = func(ctx context.Context, dir string, input []byte, args ...string) ([]byte, error) {
		if !filepath.IsAbs(dir) {
			t.Error("Compose working directory must be absolute")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		f.calls = append(f.calls, strings.Join(args, " "))
		if slices.Contains(args, "version") {
			return []byte("5.7.0"), nil
		}
		if slices.Contains(args, "config") {
			model, err := decodeComposeJSON(input)
			if err != nil {
				return nil, err
			}
			model["name"] = "demo"
			model["networks"] = map[string]any{"default": map[string]any{"name": "demo_default"}}
			return json.Marshal(model)
		}
		if !slices.Contains(args, "--no-recreate") || !slices.Contains(args, "--no-build") || args[len(args)-1] != "never" && !slices.Contains(args, "--detach") {
			t.Error("unsafe create arguments", args)
		}
		fileArg := slices.Index(args, "--file")
		if fileArg < 0 {
			t.Fatal("missing file argument")
		}
		data, err := os.ReadFile(args[fileArg+1])
		if err != nil {
			return nil, err
		}
		model, err := decodeComposeJSON(data)
		if err != nil {
			return nil, err
		}
		services, _ := composeMap(model["services"])
		web, _ := composeMap(services["web"])
		labels, _ := composeMap(web["labels"])
		f.owner, _ = labels[composeOwnerLabel].(string)
		if args[8] == "create" {
			f.created = true
			if f.createFailure {
				return nil, errors.New("private CLI value must not leak")
			}
			return nil, nil
		}
		if args[8] == "up" && slices.Contains(args, "--detach") {
			if f.startFailure {
				return nil, errors.New("private start error")
			}
			f.running = true
			return nil, nil
		}
		t.Error("unexpected operation", args)
		return nil, errors.New("unexpected operation")
	}
	api := &API{docker: docker, compose: manager}
	audit := NewAuditLog(store.dir)
	handler := withAudit(audit, api.routes(store, audit))
	t.Cleanup(api.terminals.Close)
	return handler, manager, store, audit
}
func composeHTTPRequest(handler http.Handler, token, method, path string, input any) *httptest.ResponseRecorder {
	data, _ := json.Marshal(input)
	r := httptest.NewRequest(method, path, strings.NewReader(string(data)))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}
func validatedComposeRequest(t *testing.T, handler http.Handler) ComposeRequest {
	t.Helper()
	req := ComposeRequest{Project: "demo", Compose: composeFixtureYAML}
	w := composeHTTPRequest(handler, "admin", "POST", "/api/v1/compose/validate", req)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result ComposePreview
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	req.ValidationHash = result.Hash
	return req
}
func TestComposeCreationPermissionsPersistenceAndInventory(t *testing.T) {
	f := new(composeFixture)
	handler, manager, store, audit := composeHarness(t, f)
	for _, path := range []string{"/api/v1/compose", "/api/v1/compose/validate", "/api/v1/compose/projects"} {
		method := "POST"
		if path == "/api/v1/compose" {
			method = "GET"
		}
		for token, want := range map[string]int{"": 401, "viewer": 403, "operator": 403} {
			w := composeHTTPRequest(handler, token, method, path, ComposeRequest{Project: "demo", Compose: composeFixtureYAML})
			if w.Code != want {
				t.Fatal(token, path, w.Code)
			}
		}
	}
	if len(f.calls) != 0 {
		t.Fatal("denied request reached Compose")
	}
	req := validatedComposeRequest(t, handler)
	req.Start = true
	w := composeHTTPRequest(handler, "admin", "POST", "/api/v1/compose/projects", req)
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result ComposeResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.State != "started" || len(result.Containers) != 1 || result.Containers[0].Status != "running" || result.Containers[0].ID != createdContainerID {
		t.Fatalf("wrong observed result: %+v", result)
	}
	info, err := os.Stat(filepath.Join(manager.root, "demo", "compose.json"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("manifest not private", info, err)
	}
	entries, err := audit.Tail(100)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(entries)
	if strings.Contains(string(encoded), "fixture-only-secret") {
		t.Fatal("Compose payload leaked into audit")
	}
	for _, call := range f.calls {
		if strings.Contains(call, "--remove-orphans") || strings.Contains(call, "--force-recreate") {
			t.Fatal(call)
		}
	}
	cli, err := NewAuthStore(store.dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if err = cli.RemoveUser("admin"); err != nil {
		t.Fatal(err)
	}
	if w := composeHTTPRequest(handler, "admin", "POST", "/api/v1/compose/projects", req); w.Code != 401 {
		t.Fatal("revoked admin accepted", w.Code)
	}
}
func TestComposeCreationConflictsPartialAndStorageFailures(t *testing.T) {
	for _, kind := range []string{"existing", "network", "volume", "unlabelled-network", "missing-image", "bad-hash", "partial-create", "partial-start", "disk"} {
		t.Run(kind, func(t *testing.T) {
			f := new(composeFixture)
			handler, manager, _, _ := composeHarness(t, f)
			req := validatedComposeRequest(t, handler)
			want := 409
			switch kind {
			case "existing":
				f.existing = true
			case "unlabelled-network":
				f.unlabelledNetwork = true
			case "network":
				f.networkExists = true
			case "volume":
				f.volumeExists = true
			case "missing-image":
				f.missingImage = true
				want = 422
			case "bad-hash":
				req.ValidationHash = "stale"
			case "partial-create":
				f.createFailure = true
				want = 202
			case "partial-start":
				f.startFailure = true
				req.Start = true
				want = 202
			case "disk":
				_ = os.WriteFile(manager.root, []byte("not a directory"), 0600)
				want = 500
			}
			w := composeHTTPRequest(handler, "admin", "POST", "/api/v1/compose/projects", req)
			if w.Code != want {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "private CLI") || strings.Contains(w.Body.String(), "private start") {
				t.Fatal("CLI secrets leaked")
			}
			if want == 202 {
				var result ComposeResult
				_ = json.Unmarshal(w.Body.Bytes(), &result)
				if result.State != "partial" || len(result.Containers) != 1 || result.OperationError == "" {
					t.Fatal(result)
				}
				if _, err := os.Stat(filepath.Join(manager.root, "demo", "compose.json")); err != nil {
					t.Fatal("partial project lost", err)
				}
				f.created = false
				w = composeHTTPRequest(handler, "admin", "POST", "/api/v1/compose/projects", req)
				if w.Code != 409 {
					t.Fatal("partial project can be resubmitted", w.Code)
				}
			} else {
				for _, call := range f.calls {
					if strings.Contains(call, "--no-recreate") {
						t.Fatal("failed precondition reached mutation", call)
					}
				}
			}
		})
	}
}
func TestComposeConcurrentProjectReservation(t *testing.T) {
	f := new(composeFixture)
	handler, _, _, _ := composeHarness(t, f)
	req := validatedComposeRequest(t, handler)
	statuses := make(chan int, 2)
	var group sync.WaitGroup
	for range 2 {
		group.Add(1)
		go func() {
			defer group.Done()
			statuses <- composeHTTPRequest(handler, "admin", "POST", "/api/v1/compose/projects", req).Code
		}()
	}
	group.Wait()
	close(statuses)
	values := []int{}
	for status := range statuses {
		values = append(values, status)
	}
	slices.Sort(values)
	if !slices.Equal(values, []int{201, 409}) {
		t.Fatal(values)
	}
}
func TestComposeCLIValidationIntegration(t *testing.T) {
	if os.Getenv("COREOPS_TEST_COMPOSE_CLI") != "1" {
		t.Skip("explicit local Compose CLI validation only")
	}
	manager := newComposeManager(t.TempDir(), nil)
	manager.host = "unix:///var/run/docker.sock"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	input := ComposeRequest{Project: "coreops-validate-only", Compose: "services:\n  web:\n    image: nginx:alpine\n    ports: ['8088:80']\n    environment: {VALUE: '$$LITERAL'}\n    volumes: [data:/data]\nvolumes:\n  data:\n"}
	preview, data, err := manager.preview(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Services) != 1 || len(preview.Volumes) != 1 || !strings.Contains(preview.Services[0].Ports[0], "127.0.0.1") {
		t.Fatal(preview)
	}
	if !strings.Contains(string(data), "$$LITERAL") {
		t.Fatal("literal container variable altered")
	}
}

func TestComposeCommandIsolationOutputAndCancellation(t *testing.T) {
	dir := t.TempDir()
	binary := filepath.Join(dir, "docker")
	t.Setenv("PATH", dir)
	t.Setenv("COREOPS_ADMIN_PASSWORD", "must-never-reach-child")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "also-private")
	manager := newComposeManager(t.TempDir(), nil)
	manager.host = "unix:///var/run/docker.sock"
	if err := os.WriteFile(binary, []byte("#!/bin/sh\nprintf '%s|%s|%s' \"${COREOPS_ADMIN_PASSWORD-unset}\" \"${AWS_SECRET_ACCESS_KEY-unset}\" \"$COMPOSE_DISABLE_ENV_FILE\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	output, err := manager.command(context.Background(), t.TempDir(), nil, "version", "--short")
	if err != nil || string(output) != "unset|unset|1" {
		t.Fatalf("environment not isolated: %q %v", output, err)
	}
	if err := os.WriteFile(binary, []byte("#!/bin/sh\n/usr/bin/head -c 1100000 /dev/zero\n"), 0700); err != nil {
		t.Fatal(err)
	}
	output, err = manager.command(context.Background(), t.TempDir(), nil, "version")
	if err == nil || len(output) > 1024*1024 {
		t.Fatal("output not bounded", len(output), err)
	}
	marker := filepath.Join(dir, "orphan-marker")
	script := "#!/bin/sh\n/bin/sh -c '/bin/sleep 0.3; /usr/bin/touch " + marker + "' &\nwait\n"
	if err := os.WriteFile(binary, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err = manager.command(ctx, t.TempDir(), nil, "version")
	if err == nil || time.Since(started) > 2*time.Second {
		t.Fatal("cancellation failed", err)
	}
	time.Sleep(350 * time.Millisecond)
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("child process survived Compose cancellation")
	}
}
func TestComposeRejectsUnsafeRequestBeforeCommand(t *testing.T) {
	f := new(composeFixture)
	handler, manager, _, _ := composeHarness(t, f)
	for _, path := range []string{"/api/v1/compose/validate", "/api/v1/compose/projects"} {
		request := ComposeRequest{Project: "demo", Compose: "include: /etc/private.yml\nservices: {web: {image: nginx}}"}
		w := composeHTTPRequest(handler, "admin", "POST", path, request)
		if w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if len(f.calls) > 0 {
		t.Fatal("unsafe input reached external process")
	}
	manager.run = func(context.Context, string, []byte, ...string) ([]byte, error) {
		return nil, errors.New("missing plugin")
	}
	w := composeHTTPRequest(handler, "admin", "POST", "/api/v1/compose/validate", ComposeRequest{Project: "demo", Compose: composeFixtureYAML})
	if w.Code != 503 {
		t.Fatal("missing Compose not actionable", w.Code, w.Body.String())
	}
}
