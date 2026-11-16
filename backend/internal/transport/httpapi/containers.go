package httpapi

import (
	"errors"
	"net/http"

	"github.com/ppdev28/CoreOps/backend/internal/containers"
)

type Containers struct{ service *containers.Service }

func NewContainers(service *containers.Service) *Containers { return &Containers{service: service} }
func (h *Containers) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.List(r.Context())
	if err != nil {
		WriteError(w, http.StatusBadGateway, err)
		return
	}
	response := make([]containerSummary, 0, len(items))
	for _, item := range items {
		response = append(response, toSummary(item))
	}
	WriteJSON(w, http.StatusOK, response)
}
func (h *Containers) Inspect(w http.ResponseWriter, r *http.Request) {
	detail, err := h.service.Inspect(r.Context(), r.PathValue("id"))
	if err != nil {
		WriteError(w, containerErrorStatus(err), err)
		return
	}
	WriteJSON(w, http.StatusOK, containerDetail{ID: detail.ID, Name: detail.Name, Image: detail.Image, State: detail.State, Created: detail.Created,
		Config: containerConfig{Env: detail.Config.Env, Cmd: detail.Config.Cmd, Entrypoint: detail.Config.Entrypoint, WorkingDir: detail.Config.WorkingDir}, RestartPolicy: detail.RestartPolicy,
		Mounts: detail.Mounts, Networks: detail.Networks, Ports: detail.Ports, Labels: detail.Labels})
}
func (h *Containers) Action(action containers.Action) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := h.service.Act(r.Context(), id, action); err != nil {
			WriteError(w, containerErrorStatus(err), err)
			return
		}
		WriteJSON(w, http.StatusOK, struct {
			OK bool   `json:"ok"`
			ID string `json:"id"`
		}{true, id})
	}
}
func containerErrorStatus(err error) int {
	switch {
	case errors.Is(err, containers.ErrInvalidID), errors.Is(err, containers.ErrInvalidAction):
		return http.StatusBadRequest
	case errors.Is(err, containers.ErrNotFound):
		return http.StatusNotFound
	default:
		return http.StatusBadGateway
	}
}

type containerPort struct {
	PrivatePort uint16 `json:"privatePort"`
	PublicPort  uint16 `json:"publicPort,omitempty"`
	Type        string `json:"type"`
	IP          string `json:"ip,omitempty"`
}
type containerSummary struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Image     string          `json:"image"`
	State     string          `json:"state"`
	Status    string          `json:"status"`
	CreatedAt int64           `json:"createdAt"`
	Ports     []containerPort `json:"ports"`
	Networks  []string        `json:"networks"`
}

func toSummary(c containers.Summary) containerSummary {
	ports := make([]containerPort, 0, len(c.Ports))
	for _, p := range c.Ports {
		ports = append(ports, containerPort{p.PrivatePort, p.PublicPort, p.Type, p.IP})
	}
	networks := c.Networks
	if networks == nil {
		networks = []string{}
	}
	return containerSummary{c.ID, c.Name, c.Image, c.State, c.Status, c.CreatedAt, ports, networks}
}

type containerConfig struct {
	Env        []string `json:"env"`
	Cmd        []string `json:"cmd"`
	Entrypoint []string `json:"entrypoint"`
	WorkingDir string   `json:"workingDir"`
}
type containerDetail struct {
	ID            string                             `json:"id"`
	Name          string                             `json:"name"`
	Image         string                             `json:"image"`
	State         string                             `json:"state"`
	Created       string                             `json:"created"`
	Config        containerConfig                    `json:"config"`
	RestartPolicy string                             `json:"restartPolicy"`
	Mounts        []containers.Attributes            `json:"mounts"`
	Networks      map[string]containers.Attributes   `json:"networks"`
	Ports         map[string][]containers.Attributes `json:"ports"`
	Labels        map[string]string                  `json:"labels"`
}
