package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

const (
	auditFileName    = "audit.log"
	auditTailBytes   = 512 * 1024
	auditDefaultRows = 200
	auditMaxRows     = 1000
)

// AuditEntry is one line of the append-only JSONL audit log.
type AuditEntry struct {
	Time       time.Time `json:"time"`
	User       string    `json:"user,omitempty"`
	Role       Role      `json:"role,omitempty"`
	Method     string    `json:"method"`
	Path       string    `json:"path"`
	Status     int       `json:"status"`
	Remote     string    `json:"remote"`
	Detail     string    `json:"detail,omitempty"`
	DurationMS int64     `json:"durationMs"`
}

// auditEntry is the mutable record handlers and the auth layer fill in while a
// request is being served.
type auditEntry struct {
	User   string
	Role   Role
	Detail string
}

// setAuditDetail lets a handler attach context (for example the terminal
// command) to the audit record of the current request.
func setAuditDetail(r *http.Request, detail string) {
	if entry, ok := r.Context().Value(auditCtxKey).(*auditEntry); ok {
		if len(detail) > 500 {
			detail = detail[:500] + "…"
		}
		entry.Detail = detail
	}
}

type AuditLog struct {
	mu   sync.Mutex
	path string
}

func NewAuditLog(dir string) *AuditLog {
	return &AuditLog{path: filepath.Join(dir, auditFileName)}
}

func (l *AuditLog) Append(entry AuditEntry) {
	line, err := json.Marshal(entry)
	if err != nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		slog.Error("write audit log", "error", err)
		return
	}
	defer f.Close()
	if _, err := f.Write(append(line, '\n')); err != nil {
		slog.Error("write audit log", "error", err)
	}
}

// Tail returns up to limit of the most recent entries, newest first.
func (l *AuditLog) Tail(limit int) ([]AuditEntry, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	f, err := os.Open(l.path)
	if os.IsNotExist(err) {
		return []AuditEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	start := int64(0)
	if info.Size() > auditTailBytes {
		start = info.Size() - auditTailBytes
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}
	if start > 0 { // drop the partial first line
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			data = data[i+1:]
		}
	}
	var entries []AuditEntry
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		var entry AuditEntry
		if json.Unmarshal(scanner.Bytes(), &entry) == nil {
			entries = append(entries, entry)
		}
	}
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}
	if len(entries) > limit {
		entries = entries[:limit]
	}
	return entries, nil
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// withAudit records every state-changing request (and login attempts),
// including rejected ones, with the authenticated user when known.
func withAudit(log *AuditLog, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		entry := &auditEntry{}
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r.WithContext(contextWithAudit(r, entry)))
		log.Append(AuditEntry{
			Time:       start.UTC(),
			User:       entry.User,
			Role:       entry.Role,
			Method:     r.Method,
			Path:       r.URL.Path,
			Status:     rec.status,
			Remote:     remoteHost(r),
			Detail:     entry.Detail,
			DurationMS: time.Since(start).Milliseconds(),
		})
	})
}

func (l *AuditLog) handler(w http.ResponseWriter, r *http.Request) {
	limit := auditDefaultRows
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = min(n, auditMaxRows)
		}
	}
	entries, err := l.Tail(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, entries)
}
