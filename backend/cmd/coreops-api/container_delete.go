package main

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/client"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
)

func (a *API) deleteContainer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id := r.PathValue("id")
	if !containers.ValidID(id) {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid container ID"})
		return
	}
	if r.URL.RawQuery != "" {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "container deletion does not accept force or volume removal options"})
		return
	}
	if r.Body != nil {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1))
		if err != nil || len(body) != 0 {
			writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "container deletion does not accept a request body"})
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	setAuditDetail(r, "delete container "+id+"; preserve volumes; no force")
	// Let Docker enforce stopped-state removal atomically; a prior inspect alone
	// would race with a concurrent start. Never force-kill or remove volumes.
	_, err := a.docker.ContainerRemove(ctx, id, client.ContainerRemoveOptions{
		Force: false, RemoveVolumes: false, RemoveLinks: false,
	})
	if err != nil {
		status, message := http.StatusBadGateway, "Docker could not confirm deletion. Refresh the container list before retrying."
		switch {
		case errdefs.IsNotFound(err):
			status, message = http.StatusNotFound, "container no longer exists; refresh the container list"
		case errdefs.IsConflict(err):
			status, message = http.StatusConflict, "Docker cannot delete this container in its current state. Stop it and refresh before trying again."
		case errdefs.IsInvalidArgument(err):
			status, message = http.StatusBadRequest, "Docker rejected the container deletion request"
		}
		writeJSON(w, status, ErrorResponse{Error: message})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}
