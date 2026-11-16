// Package httpapi maps CoreOps capabilities to HTTP/JSON. It owns wire DTOs,
// status codes and input/output mapping; it never imports infrastructure SDKs.
package httpapi

import (
	"encoding/json"
	"net/http"
)

type ErrorResponse struct {
	Error string `json:"error"`
}

func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func WriteError(w http.ResponseWriter, status int, err error) {
	WriteJSON(w, status, ErrorResponse{Error: err.Error()})
}
