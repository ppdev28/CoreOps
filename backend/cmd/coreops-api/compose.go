package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/client"
)

type composeRunner func(context.Context, string, []byte, ...string) ([]byte, error)
type composeManager struct {
	root, host string
	docker     *client.Client
	run        composeRunner
	slots      chan struct{}
}

func newComposeManager(root string, docker *client.Client) *composeManager {
	if absolute, err := filepath.Abs(root); err == nil {
		root = absolute
	}
	host := ""
	if docker != nil {
		host = docker.DaemonHost()
	}
	manager := &composeManager{root: root, host: host, docker: docker, slots: make(chan struct{}, 2)}
	manager.run = manager.command
	return manager
}

type composeOutput struct {
	mu        sync.Mutex
	data      []byte
	truncated bool
}

func (w *composeOutput) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	count := len(data)
	remaining := 1024*1024 - len(w.data)
	if len(data) > remaining {
		data = data[:remaining]
		w.truncated = true
	}
	w.data = append(w.data, data...)
	return count, nil
}
func (m *composeManager) command(ctx context.Context, dir string, input []byte, args ...string) ([]byte, error) {
	if !strings.HasPrefix(m.host, "unix://") {
		return nil, errors.New("Compose creation currently requires the local Unix Docker endpoint")
	}
	config := filepath.Join(dir, ".docker")
	if err := os.MkdirAll(config, 0700); err != nil {
		return nil, err
	}
	argv := append([]string{"--config", config, "--host", m.host, "compose", "--ansi", "never"}, args...)
	command := exec.CommandContext(ctx, "docker", argv...)
	command.Dir = dir
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + dir, "DOCKER_CONFIG=" + config, "COMPOSE_DISABLE_ENV_FILE=1", "COMPOSE_PARALLEL_LIMIT=2", "COMPOSE_MENU=false", "DOCKER_CLI_HINTS=false", "LC_ALL=C"}
	command.Stdin = strings.NewReader(string(input))
	output := new(composeOutput)
	command.Stdout = output
	command.Stderr = new(composeOutput)
	// The Compose plugin is a child of Docker CLI. Cancel both, not just the parent.
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Cancel = func() error {
		if command.Process == nil {
			return nil
		}
		return syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	}
	command.WaitDelay = time.Second
	err := command.Run()
	if output.truncated && err == nil {
		err = errors.New("Compose command output exceeded its limit")
	}
	return output.data, err
}
func (m *composeManager) preview(ctx context.Context, req ComposeRequest) (ComposePreview, []byte, error) {
	model, err := parseComposeDocument(req)
	if err != nil {
		return ComposePreview{}, nil, err
	}
	dir, err := os.MkdirTemp("", "coreops-compose-validate-")
	if err != nil {
		return ComposePreview{}, nil, errors.New("cannot prepare Compose validation")
	}
	defer os.RemoveAll(dir)
	// No include/extends/build/env_file/host paths reach Compose; validation below
	// already rejected them. The CLI receives only the supported standalone model.
	input, err := json.Marshal(model)
	if err != nil {
		return ComposePreview{}, nil, errors.New("invalid Compose mapping")
	}
	version, err := m.run(ctx, dir, nil, "version", "--short")
	if err != nil || strings.TrimSpace(string(version)) == "" {
		return ComposePreview{}, nil, errComposeUnavailable
	}
	output, err := m.run(ctx, dir, input, "--project-name", req.Project, "--project-directory", dir, "--env-file", "/dev/null", "--file", "-", "config", "--format", "json", "--no-interpolate", "--no-env-resolution", "--no-path-resolution")
	if err != nil {
		return ComposePreview{}, nil, errors.New("Compose validation failed; check service definitions, dependencies and field types")
	}
	normalized, err := decodeComposeJSON(output)
	if err != nil {
		return ComposePreview{}, nil, errors.New("Compose did not return a valid configuration")
	}
	if err := validateComposeModel(normalized, req.Project, true); err != nil {
		return ComposePreview{}, nil, err
	}
	return composePreview(normalized, req.Project)
}

var errComposeUnavailable = errors.New("Docker Compose is unavailable or incompatible on the API server; install the Compose CLI plugin and use the local Docker endpoint")

func decodeComposeRequest(w http.ResponseWriter, r *http.Request) (ComposeRequest, error) {
	var req ComposeRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512*1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&req) != nil || decoder.Decode(new(any)) != io.EOF {
		return req, errors.New("invalid Compose request; submit one JSON object of at most 512 KiB")
	}
	return req, nil
}
func (a *API) composeCapabilities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	dir, err := os.MkdirTemp("", "coreops-compose-capability-")
	if err != nil {
		writeJSON(w, 503, ErrorResponse{Error: "Compose cannot prepare a working directory"})
		return
	}
	defer os.RemoveAll(dir)
	version, err := a.compose.run(ctx, dir, nil, "version", "--short")
	available := err == nil && len(version) < 128 && strings.TrimSpace(string(version)) != ""
	reason := ""
	if !available {
		reason = errComposeUnavailable.Error()
	}
	writeJSON(w, 200, map[string]any{"available": available, "version": strings.TrimSpace(string(version)), "reason": reason})
}
func (a *API) validateCompose(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	req, err := decodeComposeRequest(w, r)
	if err != nil {
		writeJSON(w, 400, ErrorResponse{Error: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if !a.compose.acquire(ctx) {
		writeJSON(w, 503, ErrorResponse{Error: "Compose is busy; retry shortly"})
		return
	}
	defer a.compose.release()
	preview, _, err := a.compose.preview(ctx, req)
	if err != nil {
		status := 400
		if errors.Is(err, errComposeUnavailable) {
			status = 503
		}
		writeJSON(w, status, ErrorResponse{Error: err.Error()})
		return
	}
	setAuditDetail(r, fmt.Sprintf("validate Compose project %s; %d services", req.Project, len(preview.Services)))
	writeJSON(w, 200, preview)
}
func (m *composeManager) acquire(ctx context.Context) bool {
	select {
	case m.slots <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}
func (m *composeManager) release() { <-m.slots }
func composeProjectFilter(project string) client.Filters {
	return client.Filters{}.Add("label", "com.docker.compose.project="+project)
}
func (m *composeManager) projectExists(ctx context.Context, project string) (bool, error) {
	if m.docker == nil {
		return false, errors.New("Docker unavailable")
	}
	filters := composeProjectFilter(project)
	containers, err := m.docker.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: filters})
	if err != nil {
		return false, err
	}
	if len(containers.Items) > 0 {
		return true, nil
	}
	networks, err := m.docker.NetworkList(ctx, client.NetworkListOptions{Filters: filters})
	if err != nil {
		return false, err
	}
	if len(networks.Items) > 0 {
		return true, nil
	}
	volumes, err := m.docker.VolumeList(ctx, client.VolumeListOptions{Filters: filters})
	if err != nil {
		return false, err
	}
	return len(volumes.Items) > 0, nil
}

// Compose can adopt an existing unlabelled volume/network with the generated
// name. Reject those names too, before invoking any mutating Compose command.
func (m *composeManager) resourceNamesExist(ctx context.Context, data []byte) (bool, error) {
	model, err := decodeComposeJSON(data)
	if err != nil {
		return false, err
	}
	networks, _ := composeMap(model["networks"])
	for _, item := range networks {
		options, _ := composeMap(item)
		name, _ := options["name"].(string)
		if name == "" {
			return false, errors.New("network name unavailable")
		}
		_, err := m.docker.NetworkInspect(ctx, name, client.NetworkInspectOptions{})
		if err == nil {
			return true, nil
		}
		if !errdefs.IsNotFound(err) {
			return false, err
		}
	}
	volumes, _ := composeMap(model["volumes"])
	for _, item := range volumes {
		options, _ := composeMap(item)
		name, _ := options["name"].(string)
		if name == "" {
			return false, errors.New("volume name unavailable")
		}
		_, err := m.docker.VolumeInspect(ctx, name, client.VolumeInspectOptions{})
		if err == nil {
			return true, nil
		}
		if !errdefs.IsNotFound(err) {
			return false, err
		}
	}
	return false, nil
}

type ComposeContainer struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Service string `json:"service"`
	Status  string `json:"status"`
}
type ComposeResult struct {
	Project        string             `json:"project"`
	State          string             `json:"state"`
	Containers     []ComposeContainer `json:"containers"`
	Warnings       []string           `json:"warnings"`
	OperationError string             `json:"operationError,omitempty"`
}

func (m *composeManager) inventory(ctx context.Context, project, owner string) ([]ComposeContainer, error) {
	result, err := m.docker.ContainerList(ctx, client.ContainerListOptions{All: true, Filters: composeProjectFilter(project)})
	if err != nil {
		return nil, err
	}
	items := []ComposeContainer{}
	for _, item := range result.Items {
		if item.Labels[composeOwnerLabel] != owner {
			return nil, errors.New("project ownership could not be confirmed")
		}
		items = append(items, ComposeContainer{ID: item.ID, Name: firstContainerName(item), Service: item.Labels["com.docker.compose.service"], Status: string(item.State)})
	}
	slices.SortFunc(items, func(a, b ComposeContainer) int { return strings.Compare(a.Name, b.Name) })
	return items, nil
}
func composeOwnedModel(data []byte, owner string) ([]byte, error) {
	model, err := decodeComposeJSON(data)
	if err != nil {
		return nil, err
	}
	for _, kind := range []string{"services", "networks", "volumes"} {
		resources, _ := composeMap(model[kind])
		for _, resource := range resources {
			options, _ := composeMap(resource)
			labels := map[string]any{}
			switch current := options["labels"].(type) {
			case map[string]any:
				labels = current
			case []any:
				for _, item := range current {
					text, _ := item.(string)
					key, value, _ := strings.Cut(text, "=")
					labels[key] = value
				}
			}
			labels[composeOwnerLabel] = owner
			options["labels"] = labels
		}
	}
	return json.Marshal(model)
}
func writeComposePrivate(path string, data []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err = file.Write(data); err != nil {
		return err
	}
	return file.Sync()
}
func (a *API) createCompose(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	req, err := decodeComposeRequest(w, r)
	if err != nil {
		writeJSON(w, 400, ErrorResponse{Error: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	m := a.compose
	if !m.acquire(ctx) {
		writeJSON(w, 503, ErrorResponse{Error: "Compose is busy; retry shortly"})
		return
	}
	defer m.release()
	preview, data, err := m.preview(ctx, req)
	if err != nil {
		status := 400
		if errors.Is(err, errComposeUnavailable) {
			status = 503
		}
		writeJSON(w, status, ErrorResponse{Error: err.Error()})
		return
	}
	if req.ValidationHash == "" || req.ValidationHash != preview.Hash {
		writeJSON(w, 409, ErrorResponse{Error: "Validate the current Compose document before creating the project"})
		return
	}
	exists, err := m.projectExists(ctx, req.Project)
	if err != nil {
		writeJSON(w, 502, ErrorResponse{Error: "Cannot check existing Docker resources; no project was created"})
		return
	}
	if exists {
		writeJSON(w, 409, ErrorResponse{Error: "This project already owns Docker resources. Choose a new project name; existing projects are never updated here."})
		return
	}
	if exists, err := m.resourceNamesExist(ctx, data); err != nil {
		writeJSON(w, 502, ErrorResponse{Error: "Cannot check the new project's resource names; no project was created"})
		return
	} else if exists {
		writeJSON(w, 409, ErrorResponse{Error: "A generated network or volume name already exists. Choose another project name to avoid reusing existing data."})
		return
	}
	for _, service := range preview.Services {
		if _, err := m.docker.ImageInspect(ctx, service.Image); err != nil {
			status, message := 502, "Cannot inspect the required local images"
			if errdefs.IsNotFound(err) {
				status, message = 422, "A required image is not available locally. Pull images on the Docker host, then validate again."
			}
			writeJSON(w, status, ErrorResponse{Error: message})
			return
		}
	}
	if err := os.MkdirAll(m.root, 0700); err != nil {
		writeJSON(w, 500, ErrorResponse{Error: "Cannot persist the Compose project"})
		return
	}
	dir := filepath.Join(m.root, req.Project)
	// Mkdir reserves a fresh name atomically across updated CoreOps processes.
	if err := os.Mkdir(dir, 0700); err != nil {
		status := 500
		message := "Cannot reserve this project"
		if os.IsExist(err) {
			status = 409
			message = "This project name is already reserved. Inspect existing resources or choose another name."
		}
		writeJSON(w, status, ErrorResponse{Error: message})
		return
	}
	ownerBytes := make([]byte, 16)
	if _, err := rand.Read(ownerBytes); err != nil {
		_ = os.Remove(dir)
		writeJSON(w, 500, ErrorResponse{Error: "Cannot reserve the project identity"})
		return
	}
	owner := hex.EncodeToString(ownerBytes)
	manifest, err := composeOwnedModel(data, owner)
	if err == nil {
		err = writeComposePrivate(filepath.Join(dir, "compose.json"), manifest)
	}
	if err == nil {
		err = writeComposePrivate(filepath.Join(dir, "deployment.json"), []byte(fmt.Sprintf(`{"id":%q,"project":%q,"startRequested":%t}`, owner, req.Project, req.Start)))
	}
	if err != nil {
		_ = os.RemoveAll(dir)
		writeJSON(w, 500, ErrorResponse{Error: "Cannot persist the project; no Docker creation was attempted"})
		return
	}
	setAuditDetail(r, fmt.Sprintf("create Compose project %s; %d services; start requested=%t", req.Project, len(preview.Services), req.Start))
	baseArgs := []string{"--project-name", req.Project, "--project-directory", dir, "--env-file", "/dev/null", "--file", filepath.Join(dir, "compose.json")}
	args := append(append([]string{}, baseArgs...), "create", "--no-recreate", "--no-build", "--pull", "never")
	_, operationErr := m.run(ctx, dir, nil, args...)
	result := ComposeResult{Project: req.Project, State: "created", Containers: []ComposeContainer{}, Warnings: preview.Warnings}
	// Inspect independently even after timeout/disconnect, without undoing partial
	// creation or deleting volumes. The reserved manifest prevents blind retries.
	inventoryCtx, inventoryCancel := context.WithTimeout(context.Background(), 3*time.Second)
	items, inventoryErr := m.inventory(inventoryCtx, req.Project, owner)
	inventoryCancel()
	if inventoryErr == nil {
		result.Containers = items
	}
	if operationErr == nil && inventoryErr == nil && len(items) != len(preview.Services) {
		operationErr = errors.New("service inventory incomplete")
	}
	if operationErr == nil && inventoryErr == nil && req.Start {
		args = append(append([]string{}, baseArgs...), "up", "--detach", "--no-recreate", "--no-build", "--pull", "never")
		_, operationErr = m.run(ctx, dir, nil, args...)
		if operationErr == nil {
			result.State = "started"
		}
		inventoryCtx, inventoryCancel := context.WithTimeout(context.Background(), 3*time.Second)
		items, inventoryErr = m.inventory(inventoryCtx, req.Project, owner)
		inventoryCancel()
		if inventoryErr == nil {
			result.Containers = items
		}
		if operationErr == nil && inventoryErr == nil && len(items) != len(preview.Services) {
			operationErr = errors.New("service inventory incomplete")
		}
	}
	status := 201
	if operationErr != nil || inventoryErr != nil {
		status = 202
		result.State = "partial"
		result.OperationError = "Compose could not confirm every requested step. The project is reserved and resources may already exist. Inspect the container list before taking further action; do not submit the project again."
	}
	setAuditDetail(r, fmt.Sprintf("Compose project %s; state=%s; observed containers=%d; start requested=%t", req.Project, result.State, len(result.Containers), req.Start))
	writeJSON(w, status, result)
}
