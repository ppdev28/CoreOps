package main

import (
	"context"
	"net/http"
	"regexp"
	"strings"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

type ContainerSummary struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Image     string   `json:"image"`
	State     string   `json:"state"`
	Status    string   `json:"status"`
	CreatedAt int64    `json:"createdAt"`
	Ports     []Port   `json:"ports"`
	Networks  []string `json:"networks"`
}
type Port struct {
	PrivatePort uint16 `json:"privatePort"`
	PublicPort  uint16 `json:"publicPort,omitempty"`
	Type        string `json:"type"`
	IP          string `json:"ip,omitempty"`
}

var containerIDPattern = regexp.MustCompile(`^[a-fA-F0-9]{12,64}$`)

func (a *API) listContainers(w http.ResponseWriter, r *http.Request) {
	result, err := a.docker.ContainerList(r.Context(), client.ContainerListOptions{All: true})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	containers := result.Items
	response := make([]ContainerSummary, 0, len(containers))
	for _, c := range containers {
		response = append(response, summarizeContainer(c))
	}
	writeJSON(w, http.StatusOK, response)
}
func (a *API) getContainer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	result, err := a.docker.ContainerInspect(r.Context(), id, client.ContainerInspectOptions{})
	if err != nil {
		status := http.StatusBadGateway
		if errdefs.IsNotFound(err) {
			status = http.StatusNotFound
		}
		writeError(w, status, err)
		return
	}
	c := result.Container
	response := map[string]any{"id": c.ID, "name": strings.TrimPrefix(c.Name, "/"), "image": c.Config.Image, "state": c.State.Status, "created": c.Created, "config": map[string]any{"env": c.Config.Env, "cmd": c.Config.Cmd, "entrypoint": c.Config.Entrypoint, "workingDir": c.Config.WorkingDir}, "restartPolicy": c.HostConfig.RestartPolicy.Name, "mounts": c.Mounts, "networks": c.NetworkSettings.Networks, "ports": c.NetworkSettings.Ports, "labels": c.Config.Labels}
	writeJSON(w, http.StatusOK, response)
}
func (a *API) startContainer(w http.ResponseWriter, r *http.Request) {
	a.containerAction(w, r, func(ctx context.Context, id string) error {
		_, err := a.docker.ContainerStart(ctx, id, client.ContainerStartOptions{})
		return err
	})
}
func (a *API) stopContainer(w http.ResponseWriter, r *http.Request) {
	a.containerAction(w, r, func(ctx context.Context, id string) error {
		_, err := a.docker.ContainerStop(ctx, id, client.ContainerStopOptions{})
		return err
	})
}
func (a *API) restartContainer(w http.ResponseWriter, r *http.Request) {
	a.containerAction(w, r, func(ctx context.Context, id string) error {
		_, err := a.docker.ContainerRestart(ctx, id, client.ContainerRestartOptions{})
		return err
	})
}
func (a *API) containerAction(w http.ResponseWriter, r *http.Request, action func(context.Context, string) error) {
	id := r.PathValue("id")
	if !containerIDPattern.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid container ID"})
		return
	}
	if err := action(r.Context(), id); err != nil {
		status := http.StatusBadGateway
		if errdefs.IsNotFound(err) {
			status = http.StatusNotFound
		}
		writeError(w, status, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}
func summarizeContainer(c container.Summary) ContainerSummary {
	ports := make([]Port, 0, len(c.Ports))
	for _, p := range c.Ports {
		ports = append(ports, Port{PrivatePort: p.PrivatePort, PublicPort: p.PublicPort, Type: p.Type, IP: p.IP.String()})
	}
	networks := make([]string, 0, len(c.NetworkSettings.Networks))
	for name := range c.NetworkSettings.Networks {
		networks = append(networks, name)
	}
	name := ""
	if len(c.Names) > 0 {
		name = strings.TrimPrefix(c.Names[0], "/")
	}
	return ContainerSummary{ID: c.ID, Name: name, Image: c.Image, State: string(c.State), Status: c.Status, CreatedAt: c.Created, Ports: ports, Networks: networks}
}
