// Package docker adapts the Moby client to CoreOps capability ports.
package docker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
)

type ContainerClient interface {
	ContainerList(context.Context, client.ContainerListOptions) (client.ContainerListResult, error)
	ContainerInspect(context.Context, string, client.ContainerInspectOptions) (client.ContainerInspectResult, error)
	ContainerStart(context.Context, string, client.ContainerStartOptions) (client.ContainerStartResult, error)
	ContainerStop(context.Context, string, client.ContainerStopOptions) (client.ContainerStopResult, error)
	ContainerRestart(context.Context, string, client.ContainerRestartOptions) (client.ContainerRestartResult, error)
}

type Containers struct{ client ContainerClient }

var _ containers.Runtime = (*Containers)(nil)

func NewContainers(c ContainerClient) *Containers { return &Containers{client: c} }
func (a *Containers) List(ctx context.Context) ([]containers.Summary, error) {
	result, err := a.client.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		return nil, classify(err)
	}
	out := make([]containers.Summary, 0, len(result.Items))
	for _, item := range result.Items {
		out = append(out, summarize(item))
	}
	return out, nil
}
func (a *Containers) Inspect(ctx context.Context, reference string) (containers.Detail, error) {
	result, err := a.client.ContainerInspect(ctx, reference, client.ContainerInspectOptions{})
	if err != nil {
		return containers.Detail{}, classify(err)
	}
	c := result.Container
	if c.Config == nil || c.State == nil || c.HostConfig == nil || c.NetworkSettings == nil {
		return containers.Detail{}, errors.New("Docker returned incomplete container inspection data")
	}
	// Snapshot the legacy nested JSON without leaking any Docker types across
	// the boundary. Preserve keys/casing/nulls and future metadata for Inspect UI.
	metadata, err := snapshot(struct {
		Mounts   any `json:"mounts"`
		Networks any `json:"networks"`
		Ports    any `json:"ports"`
	}{c.Mounts, c.NetworkSettings.Networks, c.NetworkSettings.Ports})
	if err != nil {
		return containers.Detail{}, err
	}
	return containers.Detail{ID: c.ID, Name: strings.TrimPrefix(c.Name, "/"), Image: c.Config.Image, State: string(c.State.Status), Created: c.Created,
		Config:        containers.Configuration{Env: c.Config.Env, Cmd: []string(c.Config.Cmd), Entrypoint: []string(c.Config.Entrypoint), WorkingDir: c.Config.WorkingDir},
		RestartPolicy: string(c.HostConfig.RestartPolicy.Name), Mounts: metadata.Mounts, Networks: metadata.Networks, Ports: metadata.Ports, Labels: c.Config.Labels}, nil
}
func (a *Containers) Start(ctx context.Context, id string) error {
	_, err := a.client.ContainerStart(ctx, id, client.ContainerStartOptions{})
	return classify(err)
}
func (a *Containers) Stop(ctx context.Context, id string) error {
	_, err := a.client.ContainerStop(ctx, id, client.ContainerStopOptions{})
	return classify(err)
}
func (a *Containers) Restart(ctx context.Context, id string) error {
	_, err := a.client.ContainerRestart(ctx, id, client.ContainerRestartOptions{})
	return classify(err)
}

func summarize(c container.Summary) containers.Summary {
	ports := make([]containers.Port, 0, len(c.Ports))
	for _, p := range c.Ports {
		ports = append(ports, containers.Port{PrivatePort: p.PrivatePort, PublicPort: p.PublicPort, Type: p.Type, IP: p.IP.String()})
	}
	networks := make([]string, 0)
	if c.NetworkSettings != nil {
		for name := range c.NetworkSettings.Networks {
			networks = append(networks, name)
		}
	}
	name := ""
	if len(c.Names) > 0 {
		name = strings.TrimPrefix(c.Names[0], "/")
	}
	return containers.Summary{ID: c.ID, Name: name, Image: c.Image, State: string(c.State), Status: c.Status, CreatedAt: c.Created, Ports: ports, Networks: networks}
}

type metadataSnapshot struct {
	Mounts   []containers.Attributes            `json:"mounts"`
	Networks map[string]containers.Attributes   `json:"networks"`
	Ports    map[string][]containers.Attributes `json:"ports"`
}

func snapshot(value any) (metadataSnapshot, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return metadataSnapshot{}, err
	}
	var out metadataSnapshot
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	err = decoder.Decode(&out)
	return out, err
}

type notFoundError struct{ error }

func (e notFoundError) Is(target error) bool { return target == containers.ErrNotFound }
func classify(err error) error {
	if errdefs.IsNotFound(err) {
		return notFoundError{err}
	}
	return err
}
