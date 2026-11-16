package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/containerd/errdefs"
	"github.com/moby/moby/client"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
)

const maxLogBytes = 2 * 1024 * 1024
const maxLogLine = 64 * 1024

type LogEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Source    string `json:"source"`
	Message   string `json:"message"`
	Stream    string `json:"stream,omitempty"`
}
type LogsOverview struct {
	Entries      []LogEntry `json:"entries"`
	Sources      []string   `json:"sources"`
	UpdatedAt    string     `json:"updatedAt"`
	Warnings     []string   `json:"warnings,omitempty"`
	Truncated    bool       `json:"truncated,omitempty"`
	NextCursor   string     `json:"nextCursor,omitempty"`
	HistoryOrder string     `json:"historyOrder,omitempty"`
}

// collectLogs retains the aggregate route, but bounds reads and concurrent
// Docker work. Failed sources remain visible as warnings instead of fake gaps.
func collectLogs(ctx context.Context, docker *client.Client) (LogsOverview, error) {
	overview := LogsOverview{Entries: []LogEntry{}, Sources: []string{"All", "System"}}
	if page, err := collectJournalPage(ctx, journalQuery{limit: 300}); err == nil {
		overview.Entries = append(overview.Entries, page.Entries...)
		overview.Warnings = append(overview.Warnings, page.Warnings...)
	} else {
		overview.Warnings = append(overview.Warnings, "System journal is unavailable to the API service account.")
	}
	containers, err := docker.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		overview.Warnings = append(overview.Warnings, "Docker logs are unavailable; showing readable system journal records only.")
		overview.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		return overview, nil
	}
	var mu sync.Mutex
	var group sync.WaitGroup
	slots := make(chan struct{}, 4)
	for _, item := range containers.Items {
		item := item
		name := item.ID[:min(12, len(item.ID))]
		if len(item.Names) > 0 {
			name = strings.TrimPrefix(item.Names[0], "/")
		}
		overview.Sources = append(overview.Sources, name)
		group.Add(1)
		go func() {
			defer group.Done()
			select {
			case slots <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-slots }()
			entries, truncated, err := readDockerLogs(ctx, docker, item.ID, name, 100)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				overview.Warnings = append(overview.Warnings, "Logs unavailable for "+name+".")
				return
			}
			overview.Entries = append(overview.Entries, entries...)
			sort.SliceStable(overview.Entries, func(i, j int) bool { return overview.Entries[i].Timestamp < overview.Entries[j].Timestamp })
			if len(overview.Entries) > 500 {
				overview.Entries = overview.Entries[len(overview.Entries)-500:]
			}
			overview.Truncated = overview.Truncated || truncated
		}()
	}
	group.Wait()
	if ctx.Err() != nil {
		overview.Warnings = append(overview.Warnings, "Some sources did not finish before the read deadline.")
	}
	sort.SliceStable(overview.Entries, func(i, j int) bool { return overview.Entries[i].Timestamp < overview.Entries[j].Timestamp })
	if len(overview.Entries) > 500 {
		overview.Entries = overview.Entries[len(overview.Entries)-500:]
	}
	sort.Strings(overview.Sources[2:])
	overview.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return overview, nil
}

func readDockerLogs(ctx context.Context, docker *client.Client, id, name string, tail int) ([]LogEntry, bool, error) {
	result, err := docker.ContainerLogs(ctx, id, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true, Timestamps: true, Tail: strconv.Itoa(tail)})
	if err != nil {
		return nil, false, err
	}
	defer result.Close()
	data, err := io.ReadAll(io.LimitReader(result, maxLogBytes+1))
	if err != nil {
		return nil, false, err
	}
	truncated := len(data) > maxLogBytes
	if truncated {
		data = data[:maxLogBytes]
	}
	entries, cut, err := decodeDockerLogSnapshot(data, name)
	if len(entries) > tail {
		entries = entries[len(entries)-tail:]
	}
	return entries, truncated || cut, err
}

// Docker TTY output is plain text. Non-TTY output is framed and may split one
// line across multiple frames. Keep stream identity, whitespace and timestamps.
func decodeDockerLogSnapshot(data []byte, source string) (entries []LogEntry, truncated bool, err error) {
	entries = make([]LogEntry, 0, 1000)
	head := 0
	defer func() {
		if head > 0 && len(entries) == 1000 {
			entries = append(append(make([]LogEntry, 0, 1000), entries[head:]...), entries[:head]...)
		}
	}()
	emit := func(line, stream string) {
		if len(line) > maxLogLine {
			line = line[:maxLogLine]
			truncated = true
		}
		line = strings.TrimSuffix(line, "\r")
		timestamp, message := splitDockerLogTimestamp(line)
		entry := LogEntry{Timestamp: timestamp, Level: inferLogLevel(message), Source: source, Message: message, Stream: stream}
		if len(entries) < 1000 {
			entries = append(entries, entry)
		} else {
			entries[head] = entry
			head = (head + 1) % 1000
			truncated = true
		}
	}
	if len(data) == 0 {
		return entries, false, nil
	}
	if data[0] <= 3 && len(data) < 8 {
		return entries, true, nil
	}
	framed := len(data) >= 4 && data[0] <= 3 && data[1] == 0 && data[2] == 0 && data[3] == 0
	if !framed {
		payload := strings.TrimSuffix(string(data), "\n")
		for {
			line, rest, found := strings.Cut(payload, "\n")
			emit(line, "tty")
			if !found {
				break
			}
			payload = rest
		}
		return entries, truncated, nil
	}
	pending := map[byte][]byte{}
	for len(data) > 0 {
		if len(data) < 8 {
			truncated = true
			break
		}
		kind := data[0]
		if (kind != 1 && kind != 2) || data[1] != 0 || data[2] != 0 || data[3] != 0 {
			return nil, false, errors.New("invalid Docker log framing")
		}
		length := uint64(binary.BigEndian.Uint32(data[4:8]))
		data = data[8:]
		if length > uint64(len(data)) {
			truncated = true
			break
		}
		payload := string(data[:int(length)])
		data = data[int(length):]
		stream := "stdout"
		if kind == 2 {
			stream = "stderr"
		}
		for payload != "" {
			part, rest, found := strings.Cut(payload, "\n")
			remaining := maxLogLine - len(pending[kind])
			if len(part) > remaining {
				part = part[:remaining]
				truncated = true
			}
			pending[kind] = append(pending[kind], part...)
			if !found {
				break
			}
			emit(string(pending[kind]), stream)
			pending[kind] = pending[kind][:0]
			payload = rest
		}
	}
	for _, kind := range []byte{1, 2} {
		if len(pending[kind]) > 0 {
			stream := "stdout"
			if kind == 2 {
				stream = "stderr"
			}
			emit(string(pending[kind]), stream)
		}
	}
	return entries, truncated, nil
}
func splitDockerLogTimestamp(line string) (string, string) {
	token, message, found := strings.Cut(line, " ")
	if found {
		if _, err := time.Parse(time.RFC3339Nano, token); err == nil {
			return token, message
		}
	}
	return "", line
}

var logLevelPattern = regexp.MustCompile(`(?i)\b(error|err|fatal|panic|warn|warning|debug|trace|notice)\b`)

func inferLogLevel(message string) string {
	var row map[string]json.RawMessage
	if json.Unmarshal([]byte(message), &row) == nil {
		for _, key := range []string{"level", "severity", "log.level"} {
			var level string
			if json.Unmarshal(row[key], &level) == nil {
				if normalized := normalizeLogLevel(level); normalized != "" {
					return normalized
				}
			}
		}
	}
	if match := logLevelPattern.FindString(message); match != "" {
		return normalizeLogLevel(match)
	}
	return "INFO"
}
func normalizeLogLevel(value string) string {
	switch strings.ToUpper(value) {
	case "ERROR", "ERR", "FATAL", "PANIC":
		return "ERROR"
	case "WARN", "WARNING":
		return "WARN"
	case "DEBUG", "TRACE":
		return "DEBUG"
	case "NOTICE":
		return "NOTICE"
	case "INFO", "INFORMATION":
		return "INFO"
	default:
		return ""
	}
}
func (a *API) containerLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id := r.PathValue("id")
	if !containers.ValidID(id) {
		writeJSON(w, 400, ErrorResponse{Error: "invalid container ID"})
		return
	}
	tail := 500
	if raw := r.URL.Query().Get("tail"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 1000 {
			writeJSON(w, 400, ErrorResponse{Error: "tail must be between 1 and 1000"})
			return
		}
		tail = parsed
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	inspected, err := a.docker.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		status := 502
		if errdefs.IsNotFound(err) {
			status = 404
		}
		writeJSON(w, status, ErrorResponse{Error: "container logs are unavailable; refresh the container list and retry"})
		return
	}
	name := strings.TrimPrefix(inspected.Container.Name, "/")
	if name == "" {
		name = id[:min(12, len(id))]
	}
	entries, truncated, err := readDockerLogs(ctx, a.docker, id, name, tail)
	if err != nil {
		writeJSON(w, 502, ErrorResponse{Error: "Docker could not read this container's logs; its logging driver may not support log reads"})
		return
	}
	overview := LogsOverview{Entries: entries, Sources: []string{name}, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano), Truncated: truncated}
	if truncated {
		overview.Warnings = []string{"Output reached a byte, line-length or buffer limit. Refresh or narrow the tail."}
	}
	writeJSON(w, 200, overview)
}
