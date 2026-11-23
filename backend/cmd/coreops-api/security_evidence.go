package main

import (
	"context"
	"encoding/json"
	"errors"
	core "github.com/ppdev28/CoreOps/backend/internal/security"
	"io"
	"net/http"
	"strconv"
	"time"
)

var securityEvidenceSlots = make(chan struct{}, 4)

func securityEvidence(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		select {
		case securityEvidenceSlots <- struct{}{}:
			defer func() { <-securityEvidenceSlots }()
		default:
			writeError(w, 429, errors.New("Security evidence is busy"))
			return
		}
		handler(w, r)
	}
}
func (a *API) securityPosture(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		securityError(w, core.ErrInvalid)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	p, err := a.hostSecurity.Posture(ctx)
	if err != nil {
		securityError(w, err)
		return
	}
	writeJSON(w, 200, p)
}
func (a *API) securitySSHPolicy(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	for k, v := range values {
		if (k != "user" && k != "address" && k != "host") || len(v) != 1 {
			securityError(w, core.ErrInvalid)
			return
		}
	}
	c := core.SSHContext{User: values.Get("user"), Address: values.Get("address"), Host: values.Get("host")}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	p, err := a.hostSecurity.SSHPolicy(ctx, c)
	if err != nil {
		securityError(w, err)
		return
	}
	writeJSON(w, 200, p)
}
func (a *API) securityEvents(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	q := core.EventQuery{Category: "all", Direction: "older", Limit: 100}
	for k, v := range values {
		if len(v) != 1 {
			securityError(w, core.ErrInvalid)
			return
		}
		switch k {
		case "category":
			q.Category = v[0]
		case "direction":
			q.Direction = v[0]
		case "cursor":
			q.Cursor = v[0]
		case "limit":
			n, e := strconv.Atoi(v[0])
			if e != nil {
				securityError(w, core.ErrInvalid)
				return
			}
			q.Limit = n
		default:
			securityError(w, core.ErrInvalid)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	p, err := a.hostSecurity.Events(ctx, q)
	if err != nil {
		securityError(w, err)
		return
	}
	writeJSON(w, 200, p)
}
func (a *API) securityMonitorStatus(w http.ResponseWriter, r *http.Request) {
	if a.securityMonitor == nil {
		writeJSON(w, 200, core.MonitorStatus{State: "unavailable", Detail: "The journal monitor is not running in this API process", Signals: []core.Signal{}})
		return
	}
	writeJSON(w, 200, a.securityMonitor.Status())
}
func (a *API) resetSecurityMonitor(auth *AuthStore, audit *AuditLog) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Acknowledge bool `json:"acknowledgeGap"`
		}
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		d.DisallowUnknownFields()
		if r.URL.RawQuery != "" || d.Decode(&body) != nil || d.Decode(new(any)) != io.EOF || !body.Acknowledge {
			securityError(w, core.ErrInvalid)
			return
		}
		if a.securityMonitor == nil {
			securityError(w, core.ErrUnavailable)
			return
		}
		if err := a.securityMonitor.Reset(securityDispatchGuard(auth, audit, r, "reset journal cursor; previous coverage gap acknowledged")); err != nil {
			securityError(w, err)
			return
		}
		writeJSON(w, 202, map[string]bool{"accepted": true})
	}
}
