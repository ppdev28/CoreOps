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
	w.Header().Set("Cache-Control", "no-store")
	services, err := collectServices(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := a.serviceControl.Check(ctx); err != nil {
		for i := range services {
			services[i].Management = &ServiceManagement{Reason: err.Error()}
		}
	}
	writeJSON(w, http.StatusOK, services)
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

var logReadSlots = make(chan struct{}, 4)

func (a *API) logs(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	w.Header().Set("Cache-Control", "no-store")
	select {
	case logReadSlots <- struct{}{}:
		defer func() { <-logReadSlots }()
	case <-ctx.Done():
		writeJSON(w, 503, ErrorResponse{Error: "Log readers are busy; retry shortly"})
		return
	}
	switch r.URL.Query().Get("source") {
	case "system":
		query, err := parseJournalQuery(r.URL.Query())
		if err != nil {
			writeJSON(w, 400, ErrorResponse{Error: err.Error()})
			return
		}
		page, err := collectJournalPage(ctx, query)
		if err != nil {
			writeJSON(w, 502, ErrorResponse{Error: "System journal could not be read. Check permissions, the selected cursor/range, or use a smaller page."})
			return
		}
		writeJSON(w, 200, page)
		return
	case "file":
		a.fileLogs(w, r.WithContext(ctx))
		return
	case "events":
		a.dockerEvents(w, r.WithContext(ctx))
		return
	case "":
	default:
		writeJSON(w, 400, ErrorResponse{Error: "unknown log source"})
		return
	}

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
	setAuditDetail(r, "legacy terminal execution (command redacted)")
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
