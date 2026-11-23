package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/ppdev28/CoreOps/backend/internal/adapters/linuxservices"
)

var errServiceAuthorization = errors.New("operator session required")
var errServiceAudit = errors.New("service audit could not be stored; nothing was dispatched")

func (a *API) serviceAction(auth *AuthStore, audit *AuditLog, action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		name := r.PathValue("name")
		body, readErr := io.ReadAll(http.MaxBytesReader(w, r.Body, 512))
		validBody := strings.TrimSpace(string(body)) == ""
		if !validBody {
			decoder := json.NewDecoder(strings.NewReader(string(body)))
			decoder.DisallowUnknownFields()
			validBody = strings.HasPrefix(strings.TrimSpace(string(body)), "{") && decoder.Decode(&struct{}{}) == nil && decoder.Decode(new(any)) == io.EOF
		}
		if !linuxservices.ValidUnit(name) || !linuxservices.ValidAction(action) || r.URL.RawQuery != "" || readErr != nil || !validBody {
			writeError(w, 400, linuxservices.ErrInvalid)
			return
		}
		if linuxservices.Protected(name) {
			writeError(w, 403, linuxservices.ErrProtected)
			return
		}
		if !a.serviceMutation.TryLock() {
			writeError(w, 409, errors.New("a service operation is in progress; refresh before another request"))
			return
		}
		defer a.serviceMutation.Unlock()
		ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
		defer cancel()
		err := a.serviceControl.Check(ctx)
		if err == nil {
			err = serviceOperation(auth, audit, r, "service "+action+" "+name, func() error { return a.serviceControl.Execute(ctx, name, action) })
		}
		if err != nil {
			code := http.StatusBadGateway
			switch {
			case errors.Is(err, errServiceAuthorization), errors.Is(err, linuxservices.ErrPermission), errors.Is(err, linuxservices.ErrProtected):
				code = 403
			case errors.Is(err, linuxservices.ErrInvalid):
				code = 400
			case errors.Is(err, linuxservices.ErrNotFound):
				code = 404
			case errors.Is(err, errServiceAudit), errors.Is(err, linuxservices.ErrUnavailable), errors.Is(err, linuxservices.ErrUncertain):
				code = 503
			}
			writeError(w, code, err)
			return
		}
		setAuditDetail(r, "service "+action+" completed unit="+name)
		writeJSON(w, 200, map[string]any{"ok": true, "name": name, "action": action})
	}
}

func serviceOperation(auth *AuthStore, audit *AuditLog, r *http.Request, detail string, execute func() error) error {
	unlock, err := auth.lockState()
	if err != nil {
		return errServiceAuthorization
	}
	defer unlock()
	sess, ok := auth.sessions[tokenKey(bearerToken(r))]
	user, exists := auth.users[sess.User]
	if !ok || !exists || !auth.now().Before(sess.Expires) || user.Role.rank() < RoleOperator.rank() {
		return errServiceAuthorization
	}
	if err := r.Context().Err(); err != nil {
		return err
	}
	if err := audit.AppendDurable(AuditEntry{Time: time.Now().UTC(), User: user.Name, Role: user.Role, Method: r.Method, Path: r.URL.Path, Status: http.StatusProcessing, Remote: remoteHost(r), Detail: "Services dispatch requested " + detail}); err != nil {
		return errServiceAudit
	}
	if !auth.now().Before(sess.Expires) {
		return errServiceAuthorization
	}
	if err := r.Context().Err(); err != nil {
		return err
	}
	return execute()
}
