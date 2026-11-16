package main

import (
	"context"
	"errors"
	"github.com/ppdev28/CoreOps/backend/internal/monitoring"
	"net/http"
	"time"
)

func (a *API) monitoringHistory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	span := r.URL.Query().Get("range")
	if span == "" {
		span = "24h"
	}
	if _, ok := monitoring.Ranges[span]; !ok {
		writeError(w, 400, monitoring.ErrRange)
		return
	}
	if a.history == nil {
		writeError(w, 503, monitoring.ErrUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	data, e := a.history.Query(ctx, span, time.Now().UTC())
	if e != nil {
		status := 503
		if errors.Is(e, monitoring.ErrRange) {
			status = 400
		}
		writeError(w, status, errors.New("Recorded host history is unavailable. Check sysstat collection, retention and service read permissions."))
		return
	}
	writeJSON(w, 200, data)
}
