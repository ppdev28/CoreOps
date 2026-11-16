package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	core "github.com/ppdev28/CoreOps/backend/internal/security"
)

type SecurityCheck = core.Check
type SecuritySession = core.Session
type FirewallRule = core.Rule
type SecurityEvent = core.Event
type SecurityOverview = core.Overview

// Parser compatibility for the existing transport regression tests.
func parseUFWRules(text string) []FirewallRule { return core.ParseRules(text) }
func classifySecurityEvent(text string) string { return core.Classify(text) }
func detectUFWActive(text string) (bool, string) {
	active, ok := core.Firewall(text)
	if !ok {
		return false, "Live UFW status unavailable"
	}
	return *active, "Live UFW status"
}

func (a *API) security(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	overview, err := a.hostSecurity.Overview(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}
func securityError(w http.ResponseWriter, err error) {
	code := http.StatusBadGateway
	switch {
	case errors.Is(err, core.ErrInvalid):
		code = http.StatusBadRequest
	case errors.Is(err, core.ErrNotFound):
		code = http.StatusNotFound
	case errors.Is(err, core.ErrConflict):
		code = http.StatusConflict
	case errors.Is(err, core.ErrPermission), core.Status(err).State == "permission_denied":
		code = http.StatusForbidden
	case errors.Is(err, core.ErrUnsupported):
		code = http.StatusNotImplemented
	case errors.Is(err, core.ErrUnavailable), core.Status(err).State == "unavailable":
		code = http.StatusServiceUnavailable
	}
	writeError(w, code, err)
}
func (a *API) terminateSecuritySession(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil {
		securityError(w, core.ErrInvalid)
		return
	}
	var body struct {
		ID string `json:"id"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	d.DisallowUnknownFields()
	if d.Decode(&body) != nil || d.Decode(new(any)) != io.EOF {
		securityError(w, core.ErrInvalid)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	session, err := a.hostSecurity.Terminate(ctx, pid, body.ID)
	if err != nil {
		securityError(w, err)
		return
	}
	setAuditDetail(r, fmt.Sprintf("SSH termination requested user=%s terminal=%s pid=%d session=%s", session.User, session.Terminal, session.PID, session.ID))
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "pid": session.PID, "id": session.ID, "status": "termination_requested"})
}
func (a *API) fixSecurity(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("item") != "auto-updates" {
		writeJSON(w, http.StatusNotFound, ErrorResponse{Error: "unknown security fix"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if err := a.hostSecurity.EnableAutoUpdates(ctx); err != nil {
		securityError(w, err)
		return
	}
	setAuditDetail(r, "Automatic update scheduling verified; APT policy and apt-daily-upgrade.timer checked")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "item": "auto-updates", "verified": true})
}
