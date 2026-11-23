package main

import (
	"context"
	"encoding/json"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"io"
	"net/http"
	"time"
)

func (a *API) securityScanCapabilities(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	caps, err := a.securityScans.Capabilities(ctx)
	if err != nil {
		securityError(w, err)
		return
	}
	writeJSON(w, 200, caps)
}
func (a *API) securityScanJobs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, a.securityScans.Jobs())
}
func (a *API) startSecurityScan(auth *AuthStore, audit *AuditLog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input core.ScanRequest
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		d.DisallowUnknownFields()
		if r.URL.RawQuery != "" || d.Decode(&input) != nil || d.Decode(new(any)) != io.EOF {
			securityError(w, core.ErrInvalid)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		job, err := a.securityScans.Start(ctx, input, tokenKey(bearerToken(r)), securityDispatchGuard(auth, audit, r, "vulnerability scan target="+input.Target+" request="+input.RequestID))
		if err != nil {
			securityError(w, err)
			return
		}
		setAuditDetail(r, "vulnerability scan accepted request="+input.RequestID)
		writeJSON(w, 202, job)
	}
}
