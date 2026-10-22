package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/moby/moby/client"
)

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if _, err := a.docker.Ping(ctx, client.PingOptions{}); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "degraded", "docker": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "docker": "available"})
}
func (a *API) host(w http.ResponseWriter, r *http.Request) {
	overview, err := collectHostOverview()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}
func (a *API) listApplications(w http.ResponseWriter, r *http.Request) {
	applications, err := collectApplications(r.Context(), a.docker)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, applications)
}
func (a *API) applicationAction(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	action := r.PathValue("action")
	if action != "start" && action != "stop" && action != "restart" {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid application action"})
		return
	}
	applications, err := collectApplications(r.Context(), a.docker)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	var ids []string
	for _, app := range applications {
		if app.ID == id {
			ids = app.ContainerIDs
			break
		}
	}
	if len(ids) == 0 {
		writeJSON(w, http.StatusNotFound, ErrorResponse{Error: "application not found"})
		return
	}
	if err := applicationAction(r.Context(), a.docker, ids, action); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id, "action": action})
}
func (a *API) listVirtualMachines(w http.ResponseWriter, r *http.Request) {
	machines, err := collectVirtualMachines(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, machines)
}
func (a *API) virtualMachineAction(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	action := r.PathValue("action")
	if action != "start" && action != "shutdown" {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid virtual machine action"})
		return
	}
	if err := virtualMachineAction(r.Context(), name, action); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, VirtualMachineActionResponse{OK: true, Name: name, Action: action})
}
func (a *API) listServices(w http.ResponseWriter, r *http.Request) {
	services, err := collectServices(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, services)
}
func (a *API) startService(w http.ResponseWriter, r *http.Request) { a.serviceAction(w, r, "start") }
func (a *API) stopService(w http.ResponseWriter, r *http.Request)  { a.serviceAction(w, r, "stop") }
func (a *API) restartService(w http.ResponseWriter, r *http.Request) {
	a.serviceAction(w, r, "restart")
}
func (a *API) serviceAction(w http.ResponseWriter, r *http.Request, action string) {
	name := r.PathValue("name")
	if !systemdUnitPattern.MatchString(name) {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid systemd service name"})
		return
	}
	if err := serviceAction(r.Context(), name, action); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": name, "action": action})
}
func (a *API) storage(w http.ResponseWriter, r *http.Request) {
	overview, err := collectStorage(r.Context(), a.docker)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}
func (a *API) network(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	overview, err := collectNetwork(ctx, a.docker)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}
func (a *API) monitoring(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	overview, err := collectMonitoring(ctx, a.docker)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}
func (a *API) logs(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	overview, err := collectLogs(ctx, a.docker)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}
func (a *API) terminalExec(w http.ResponseWriter, r *http.Request) {
	var req TerminalExecRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid terminal request"})
		return
	}
	if strings.TrimSpace(req.Command) == "" {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "command is required"})
		return
	}
	setAuditDetail(r, "exec: "+req.Command)
	result, err := executeTerminalCommand(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (a *API) terminalComplete(w http.ResponseWriter, r *http.Request) {
	var req TerminalCompleteRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid terminal completion request"})
		return
	}
	result, err := completeTerminalInput(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
