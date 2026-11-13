package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/moby/moby/client"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
)

type contractRuntime struct {
	calls int
	err   error
	empty bool
}

func (f *contractRuntime) check(ctx context.Context) error {
	f.calls++
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return f.err
}
func (f *contractRuntime) List(ctx context.Context) ([]containers.Summary, error) {
	if err := f.check(ctx); err != nil {
		return nil, err
	}
	if f.empty {
		return nil, nil
	}
	return []containers.Summary{{ID: "abcdef123456", Name: "nginx", Image: "nginx:stable", State: "running", Status: "Up 1 day", CreatedAt: 123}}, nil
}
func (f *contractRuntime) Inspect(ctx context.Context, id string) (containers.Detail, error) {
	if err := f.check(ctx); err != nil {
		return containers.Detail{}, err
	}
	return containers.Detail{ID: id, Name: "nginx", Image: "nginx:stable", State: "running", Created: "2026-11-01T00:00:00Z", Config: containers.Configuration{}}, nil
}
func (f *contractRuntime) Start(ctx context.Context, id string) error   { return f.check(ctx) }
func (f *contractRuntime) Stop(ctx context.Context, id string) error    { return f.check(ctx) }
func (f *contractRuntime) Restart(ctx context.Context, id string) error { return f.check(ctx) }

func TestInitialOpenAPIContractAndRealRoutePolicy(t *testing.T) {
	loader := openapi3.NewLoader()
	spec, err := loader.LoadFromFile("../../../api/openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := spec.Validate(context.Background()); err != nil {
		t.Fatal(err)
	}
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("API-Version", "1.52")
		w.WriteHeader(200)
	}))
	defer engine.Close()
	sdk, err := client.NewClientWithOpts(client.WithHost(engine.URL), client.WithVersion("1.52"))
	if err != nil {
		t.Fatal(err)
	}
	defer sdk.Close()
	store := newTestStore(t)
	// Seed sessions directly so route contract tests do not spend most of their
	// time hashing passwords. Login's behavior is also covered by auth_test.go.
	for _, role := range []Role{RoleViewer, RoleOperator, RoleAdmin} {
		store.users[string(role)] = User{Name: string(role), Role: role, PasswordHash: dummyHash}
		store.sessions[tokenKey(string(role))] = session{User: string(role), Expires: time.Now().Add(time.Hour)}
	}
	store.sessions[tokenKey("viewer-live")] = session{User: "viewer", Expires: time.Now().Add(time.Hour)}
	runtime := &contractRuntime{}
	api := &API{docker: sdk, containers: containers.New(runtime)}
	audit := NewAuditLog(store.dir)
	handler := withAudit(audit, api.routes(store, audit))
	defer api.terminals.Close()
	cases := []struct {
		name, method, path, contractPath, token, body string
		status                                        int
		err                                           error
		empty, canceled                               bool
	}{
		{name: "health public", method: "GET", path: "/health", contractPath: "/health", status: 200},
		{name: "me", method: "GET", path: "/auth/me", contractPath: "/auth/me", token: "viewer", status: 200},
		{name: "me anonymous", method: "GET", path: "/auth/me", contractPath: "/auth/me", status: 401},
		{name: "login invalid JSON", method: "POST", path: "/auth/login", contractPath: "/auth/login", body: "{", status: 400},
		{name: "login credentials", method: "POST", path: "/auth/login", contractPath: "/auth/login", body: `{"username":"absent","password":"wrong"}`, status: 401},
		{name: "login success", method: "POST", path: "/auth/login", contractPath: "/auth/login", body: `{"username":"admin","password":"coreops-dummy-password"}`, status: 200},
		{name: "list anonymous", method: "GET", path: "/containers", contractPath: "/containers", status: 401},
		{name: "list viewer", method: "GET", path: "/containers", contractPath: "/containers", token: "viewer", status: 200},
		{name: "empty array", method: "GET", path: "/containers", contractPath: "/containers", token: "viewer", status: 200, empty: true},
		{name: "list unavailable", method: "GET", path: "/containers", contractPath: "/containers", token: "viewer", status: 502, err: errors.New("runtime unavailable")},
		{name: "inspect viewer denied", method: "GET", path: "/containers/abcdef123456", contractPath: "/containers/{id}", token: "viewer", status: 403},
		{name: "inspect operator", method: "GET", path: "/containers/abcdef123456", contractPath: "/containers/{id}", token: "operator", status: 200},
		{name: "inspect by name", method: "GET", path: "/containers/nginx", contractPath: "/containers/{id}", token: "operator", status: 200},
		{name: "inspect not found", method: "GET", path: "/containers/abcdef123456", contractPath: "/containers/{id}", token: "operator", status: 404, err: containers.ErrNotFound},
		{name: "inspect unavailable", method: "GET", path: "/containers/abcdef123456", contractPath: "/containers/{id}", token: "operator", status: 502, err: errors.New("unavailable")},
		{name: "logout", method: "POST", path: "/auth/logout", contractPath: "/auth/logout", token: "viewer", status: 200},
		{name: "logged out denied", method: "GET", path: "/auth/me", contractPath: "/auth/me", token: "viewer", status: 401},
	}
	for _, action := range []string{"start", "stop", "restart"} {
		for _, item := range []struct {
			name, token, id string
			status          int
			err             error
			canceled        bool
		}{
			{"anonymous", "", "abcdef123456", 401, nil, false},
			{"viewer denied", "viewer-live", "abcdef123456", 403, nil, false},
			{"operator", "operator", "abcdef123456", 200, nil, false},
			{"admin", "admin", "abcdef123456", 200, nil, false},
			{"invalid ID", "operator", "bad-id", 400, nil, false},
			{"not found", "operator", "abcdef123456", 404, containers.ErrNotFound, false},
			{"runtime failed", "operator", "abcdef123456", 502, errors.New("runtime unavailable"), false},
			{"canceled", "operator", "abcdef123456", 502, nil, true},
		} {
			cases = append(cases, struct {
				name, method, path, contractPath, token, body string
				status                                        int
				err                                           error
				empty, canceled                               bool
			}{name: action + " " + item.name, method: "POST", path: "/containers/" + item.id + "/" + action, contractPath: "/containers/{id}/" + action, token: item.token, status: item.status, err: item.err, canceled: item.canceled})
		}
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			runtime.err = tc.err
			runtime.empty = tc.empty
			before := runtime.calls
			req := httptest.NewRequest(tc.method, "http://coreops.test/api/v1"+tc.path, strings.NewReader(tc.body))
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			if tc.canceled {
				ctx, cancel := context.WithCancel(req.Context())
				cancel()
				req = req.WithContext(ctx)
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, req)
			if recorder.Code != tc.status {
				t.Fatalf("got %d want %d: %s", recorder.Code, tc.status, recorder.Body.String())
			}
			if tc.status == 401 || tc.status == 403 || tc.status == 400 {
				if runtime.calls != before {
					t.Fatal("denied/invalid request reached container runtime")
				}
			}
			item := spec.Paths.Find(tc.contractPath)
			op := item.GetOperation(tc.method)
			route := &routers.Route{Spec: spec, Server: spec.Servers[0], Path: tc.contractPath, PathItem: item, Method: tc.method, Operation: op}
			input := &openapi3filter.ResponseValidationInput{RequestValidationInput: &openapi3filter.RequestValidationInput{Request: req, Route: route}, Status: recorder.Code, Header: recorder.Header(), Body: io.NopCloser(bytes.NewReader(recorder.Body.Bytes())), Options: &openapi3filter.Options{IncludeResponseStatus: true}}
			// Validate content even for a canceled request: schema validation has its own context.
			if err := openapi3filter.ValidateResponse(context.Background(), input); err != nil {
				t.Fatal(err)
			}
			if tc.name == "empty array" && strings.TrimSpace(recorder.Body.String()) != "[]" {
				t.Fatal("empty list is not []")
			}
			if tc.method == "POST" && strings.HasPrefix(tc.path, "/containers/") && tc.status == 200 && runtime.calls != before+1 {
				t.Fatal("action was retried")
			}
			if _, ok := op.Responses.Map()[strconv.Itoa(recorder.Code)]; !ok {
				t.Fatal("undocumented status")
			}
		})
	}
	rows, err := audit.Tail(100)
	if err != nil {
		t.Fatal(err)
	}
	var sawAction bool
	for _, row := range rows {
		if row.Method == "POST" && strings.HasPrefix(row.Path, "/api/v1/containers/") && row.User == "operator" && row.Status == 200 {
			sawAction = true
		}
	}
	if !sawAction {
		t.Fatal("container actions lost audit attribution")
	}
}
