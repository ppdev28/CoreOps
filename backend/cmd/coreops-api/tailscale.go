package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	core "github.com/ppdev28/CoreOps/backend/internal/tailscale"
)

var tailscaleReadSlots = make(chan struct{}, 2)

func (a *API) tailscaleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	select {
	case tailscaleReadSlots <- struct{}{}:
		defer func() { <-tailscaleReadSlots }()
	default:
		writeError(w, 429, errors.New("Tailscale status is busy; retry shortly"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	snapshot, err := a.tailscale.Inspect(ctx)
	if err != nil {
		writeError(w, 503, errors.New("Tailscale status is unavailable"))
		return
	}
	writeJSON(w, 200, snapshot)
}
func (a *API) tailscaleAction(auth *AuthStore, audit *AuditLog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, private")
		var input core.Request
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
		dec.DisallowUnknownFields()
		if r.URL.RawQuery != "" || dec.Decode(&input) != nil || dec.Decode(&struct{}{}) != io.EOF || !core.ValidRequest(input) {
			writeError(w, 400, core.ErrInvalid)
			return
		}
		setAuditDetail(r, "Tailscale "+input.Action+" request="+input.RequestID)
		ctx, cancel := context.WithTimeout(r.Context(), 18*time.Second)
		defer cancel()
		result, err := a.tailscale.Submit(ctx, input, tokenKey(bearerToken(r)), func() error {
			user, valid := auth.Authenticate(bearerToken(r))
			if !valid || user.Role != RoleAdmin {
				return errUserCreationDenied
			}
			return audit.AppendDurable(AuditEntry{Time: time.Now().UTC(), User: user.Name, Role: user.Role, Method: r.Method, Path: r.URL.Path, Status: http.StatusProcessing, Remote: r.RemoteAddr, Detail: "Tailscale dispatch requested action=" + input.Action + " request=" + input.RequestID})
		})
		switch {
		case errors.Is(err, errUserCreationDenied):
			writeError(w, 403, errors.New("administrator session required"))
		case errors.Is(err, core.ErrInvalid):
			writeError(w, 400, err)
		case errors.Is(err, core.ErrChanged):
			writeError(w, 409, err)
		case errors.Is(err, core.ErrBusy):
			writeError(w, 409, err)
		case errors.Is(err, core.ErrUnavailable):
			writeError(w, 403, err)
		case err != nil:
			writeError(w, 503, errors.New("Tailscale did not confirm the request; outcome may be uncertain. Refresh status and verify host access before retrying"))
		default:
			writeJSON(w, 202, result)
		}
	}
}
