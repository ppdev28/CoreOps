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
func (a *API) terminateSecuritySession(auth *AuthStore, audit *AuditLog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
		session, err := a.hostSecurity.Terminate(ctx, pid, body.ID, securityOperationGuard(auth, audit, r, fmt.Sprintf("terminate pid=%d session=%s", pid, body.ID)))
		if err != nil {
			securityError(w, err)
			return
		}
		setAuditDetail(r, fmt.Sprintf("SSH termination requested user=%s terminal=%s pid=%d session=%s", session.User, session.Terminal, session.PID, session.ID))
		writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "pid": session.PID, "id": session.ID, "status": "termination_requested"})
	}
}
func (a *API) fixSecurity(auth *AuthStore, audit *AuditLog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("item") != "auto-updates" {
			writeJSON(w, http.StatusNotFound, ErrorResponse{Error: "unknown security fix"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		if err := a.hostSecurity.EnableAutoUpdates(ctx, securityOperationGuard(auth, audit, r, "enable-auto-updates")); err != nil {
			securityError(w, err)
			return
		}
		setAuditDetail(r, "Automatic update scheduling verified; APT policy and apt-daily-upgrade.timer checked")
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "item": "auto-updates", "verified": true})
	}

}

// The intent must be durable before dispatch; a revocation while evidence or
// audit storage was being read blocks the operation. No secret is recorded.
func securityDispatchGuard(auth *AuthStore, audit *AuditLog, r *http.Request, detail string) func() error {
	return func() error {
		if err := r.Context().Err(); err != nil {
			return err
		}
		user, valid := auth.Authenticate(bearerToken(r))
		if !valid || user.Role != RoleAdmin {
			return core.ErrPermission
		}
		if err := audit.AppendDurable(AuditEntry{Time: time.Now().UTC(), User: user.Name, Role: user.Role, Method: r.Method, Path: r.URL.Path, Status: http.StatusProcessing, Remote: remoteHost(r), Detail: "Security dispatch requested " + detail}); err != nil {
			return core.ErrUnavailable
		}
		if err := r.Context().Err(); err != nil {
			return err
		}
		current, valid := auth.Authenticate(bearerToken(r))
		if !valid || current.Role != RoleAdmin || current.Name != user.Name {
			return core.ErrPermission
		}
		return nil
	}
}

// Hold the existing cross-process identity lock through the bounded effect.
// A logout/role update either wins before dispatch (and blocks it) or completes
// afterwards; the actor cannot be revoked between validation and the syscall.
func securityOperationGuard(auth *AuthStore, audit *AuditLog, r *http.Request, detail string) core.MutationGuard {
	return func(execute func() error) error {
		unlock, err := auth.lockState()
		if err != nil {
			return core.ErrUnavailable
		}
		defer unlock()
		sess, ok := auth.sessions[tokenKey(bearerToken(r))]
		user, present := auth.users[sess.User]
		if !ok || !present || !auth.now().Before(sess.Expires) || user.Role != RoleAdmin {
			return core.ErrPermission
		}
		if err = r.Context().Err(); err != nil {
			return err
		}
		if err = audit.AppendDurable(AuditEntry{Time: time.Now().UTC(), User: user.Name, Role: user.Role, Method: r.Method, Path: r.URL.Path, Status: http.StatusProcessing, Remote: remoteHost(r), Detail: "Security dispatch requested " + detail}); err != nil {
			return core.ErrUnavailable
		}
		if err = r.Context().Err(); err != nil {
			return err
		}
		if !auth.now().Before(sess.Expires) {
			return core.ErrPermission
		}
		return execute()
	}
}
