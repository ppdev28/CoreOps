package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
)

type CreateContainerRequest struct {
	Name          string                 `json:"name"`
	Image         string                 `json:"image"`
	Environment   []string               `json:"environment,omitempty"`
	Command       []string               `json:"command,omitempty"`
	Ports         []ContainerPortMapping `json:"ports,omitempty"`
	RestartPolicy string                 `json:"restartPolicy,omitempty"`
	Start         bool                   `json:"start"`
}

type ContainerPortMapping struct {
	HostIP        string `json:"hostIp"`
	HostPort      int    `json:"hostPort"`
	ContainerPort int    `json:"containerPort"`
	Protocol      string `json:"protocol"`
}

type CreateContainerResponse struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Started    bool     `json:"started"`
	Warnings   []string `json:"warnings"`
	StartError string   `json:"startError,omitempty"`
}

var containerNamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)
var environmentNamePattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

func (req *CreateContainerRequest) validate() error {
	if !containerNamePattern.MatchString(req.Name) {
		return errors.New("name must be 1–128 letters, digits, dots, underscores or hyphens, starting with a letter or digit")
	}
	if req.Image == "" || len(req.Image) > 512 || strings.IndexFunc(req.Image, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 {
		return errors.New("provide a valid local image name, tag or digest")
	}
	if req.RestartPolicy == "" {
		req.RestartPolicy = "no"
	}
	switch req.RestartPolicy {
	case "no", "always", "unless-stopped", "on-failure":
	default:
		return errors.New("invalid restart policy")
	}
	if len(req.Environment) > 100 || len(req.Command) > 64 || len(req.Ports) > 32 {
		return errors.New("maximum 100 environment variables, 64 command arguments and 32 port mappings")
	}
	names := map[string]bool{}
	for _, value := range req.Environment {
		name, _, found := strings.Cut(value, "=")
		if !found || !environmentNamePattern.MatchString(name) || len(value) > 4096 || strings.ContainsRune(value, 0) || names[name] {
			return errors.New("environment variables must have unique valid names and use NAME=value (maximum 4096 characters each)")
		}
		names[name] = true
	}
	for _, arg := range req.Command {
		if len(arg) > 4096 || strings.ContainsRune(arg, 0) {
			return errors.New("invalid command argument")
		}
	}
	ports := map[string]bool{}
	for i := range req.Ports {
		p := &req.Ports[i]
		if p.HostIP == "" {
			p.HostIP = "127.0.0.1"
		}
		if ip, err := netip.ParseAddr(p.HostIP); err != nil || ip.Zone() != "" {
			return errors.New("port binding requires a valid host IP address")
		}
		if p.Protocol == "" {
			p.Protocol = "tcp"
		}
		if (p.Protocol != "tcp" && p.Protocol != "udp") || p.HostPort < 1 || p.HostPort > 65535 || p.ContainerPort < 1 || p.ContainerPort > 65535 {
			return errors.New("ports must be between 1 and 65535 and use tcp or udp")
		}
		key := fmt.Sprintf("%d/%s", p.HostPort, p.Protocol)
		if ports[key] {
			return errors.New("each host port/protocol may only be published once")
		}
		ports[key] = true
	}
	return nil
}

func (req CreateContainerRequest) dockerOptions() client.ContainerCreateOptions {
	exposed := network.PortSet{}
	bindings := network.PortMap{}
	for _, p := range req.Ports {
		port, _ := network.ParsePort(fmt.Sprintf("%d/%s", p.ContainerPort, p.Protocol))
		ip, _ := netip.ParseAddr(p.HostIP)
		exposed[port] = struct{}{}
		bindings[port] = append(bindings[port], network.PortBinding{HostIP: ip, HostPort: strconv.Itoa(p.HostPort)})
	}
	return client.ContainerCreateOptions{
		Name:   req.Name,
		Config: &container.Config{Image: req.Image, Env: req.Environment, Cmd: req.Command, ExposedPorts: exposed},
		HostConfig: &container.HostConfig{
			NetworkMode: "bridge", PortBindings: bindings,
			RestartPolicy: container.RestartPolicy{Name: container.RestartPolicyMode(req.RestartPolicy)},
		},
	}
}

func (a *API) createContainer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var req CreateContainerRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid create request (maximum 64 KiB); use only the supported fields"})
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "request must contain one JSON object"})
		return
	}
	if err := req.validate(); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	setAuditDetail(r, "create container "+req.Name)
	// Creation uses local images only: no hidden registry pulls or long-running jobs.
	created, err := a.docker.ContainerCreate(ctx, req.dockerOptions())
	if err != nil {
		status, message := http.StatusBadGateway, "Docker could not confirm creation. Refresh the container list before retrying."
		switch {
		case errdefs.IsConflict(err):
			status, message = http.StatusConflict, "a container with this name already exists; choose another name or inspect the existing container"
		case errdefs.IsNotFound(err):
			status, message = http.StatusUnprocessableEntity, "image is not available locally; pull it on the Docker host before creating the container"
		case errdefs.IsInvalidArgument(err):
			status, message = http.StatusBadRequest, "Docker rejected the image or configuration; check the image reference and fields"
		}
		writeJSON(w, status, ErrorResponse{Error: message})
		return
	}
	if created.ID == "" {
		writeJSON(w, http.StatusBadGateway, ErrorResponse{Error: "Docker returned no container ID. Refresh the container list before retrying."})
		return
	}
	result := CreateContainerResponse{ID: created.ID, Name: req.Name, Warnings: created.Warnings}
	if result.Warnings == nil {
		result.Warnings = []string{}
	}
	if req.Start {
		_, err = a.docker.ContainerStart(ctx, created.ID, client.ContainerStartOptions{})
		if err == nil {
			result.Started = true
		} else {
			result.StartError = "Container created, but Docker could not confirm its start. Inspect its current state before starting it again."
		}
	}
	setAuditDetail(r, fmt.Sprintf("created container %s (%s); start requested=%t; start confirmed=%t", req.Name, created.ID, req.Start, result.Started))
	w.Header().Set("Location", "/api/v1/containers/"+created.ID)
	writeJSON(w, http.StatusCreated, result)
}
