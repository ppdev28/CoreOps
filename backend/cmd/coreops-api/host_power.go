package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/ppdev28/CoreOps/backend/internal/hostpower"
)

func (a *API) powerStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	info, err := a.power.Inspect(ctx)
	if err != nil {
		writeError(w, 503, errors.New("host power status is unavailable"))
		return
	}
	writeJSON(w, 200, info)
}
func (a *API) powerAction(auth *AuthStore, audit *AuditLog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		var input hostpower.Request
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
		dec.DisallowUnknownFields()
		if r.URL.RawQuery != "" || dec.Decode(&input) != nil || dec.Decode(&struct{}{}) != io.EOF || len(input.Hostname) > 255 || len(input.BootID) > 64 {
			writeError(w, 400, hostpower.ErrInvalid)
			return
		}
		if hostpower.ValidAction(input.Action) {
			setAuditDetail(r, "host power "+input.Action)
		}
		actor, ok := auth.Authenticate(bearerToken(r))
		if !ok || actor.Role != RoleAdmin {
			writeError(w, 403, errors.New("administrator session required"))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		result, err := a.power.Submit(ctx, input, tokenKey(bearerToken(r)), func() error {
			// Revalidate after capability collection and persist intent before the
			// operating system can stop this process or close the connection.
			current, valid := auth.Authenticate(bearerToken(r))
			if !valid || current.Role != RoleAdmin {
				return errUserCreationDenied
			}
			return audit.AppendDurable(AuditEntry{Time: time.Now().UTC(), User: current.Name, Role: current.Role, Method: r.Method, Path: r.URL.Path, Status: http.StatusProcessing, Remote: r.RemoteAddr, Detail: "host power dispatch requested action=" + input.Action + " request=" + input.RequestID})
		})
		switch {
		case errors.Is(err, errUserCreationDenied):
			writeError(w, 403, errors.New("administrator session required"))
		case errors.Is(err, hostpower.ErrInvalid):
			writeError(w, 400, err)
		case errors.Is(err, hostpower.ErrTarget):
			writeError(w, 409, err)
		case errors.Is(err, hostpower.ErrUnavailable):
			writeError(w, 403, err)
		case errors.Is(err, hostpower.ErrBusy):
			writeError(w, 429, err)
		case err != nil:
			writeError(w, 503, errors.New("power request outcome is unconfirmed; check host permissions and inhibitors, and verify the host before trying again"))
		default:
			writeJSON(w, http.StatusAccepted, result)
		}
	}
}
