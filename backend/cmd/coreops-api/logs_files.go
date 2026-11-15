package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type hostLogSource struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Readable bool   `json:"readable"`
	Archive  bool   `json:"archive"`
}
type hostLogCatalog struct {
	Files    []hostLogSource `json:"files"`
	Warnings []string        `json:"warnings"`
}

var textLogName = regexp.MustCompile(`(?i)(^|/)([^/]+\.(log|err|out)|syslog|messages|secure|debug|dmesg|cron|maillog|mail|errors)(\.[0-9-]+)?(\.gz)?$`)

func validHostLogPath(name string) bool {
	if len(name) > 512 || !textLogName.MatchString(name) || strings.HasPrefix(name, "/") || strings.ContainsAny(name, "\\\x00\r\n") || path.Clean(name) != name {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") || part == "journal" {
			return false
		}
	}
	return true
}
func (a *API) hostLogRoot() string {
	if a.logRoot != "" {
		return a.logRoot
	}
	return "/var/log"
}
func openHostLog(root *os.Root, name string) (*os.File, error) {
	if !validHostLogPath(name) {
		return nil, errors.New("invalid log path")
	}
	parts := strings.Split(name, "/")
	for i := range parts {
		info, err := root.Lstat(strings.Join(parts[:i+1], "/"))
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("log symlinks are not supported")
		}
	}
	file, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, errors.New("log must be a regular file")
	}
	if !strings.HasSuffix(name, ".gz") {
		var probe [512]byte
		n, _ := file.ReadAt(probe[:], 0)
		if bytes.IndexByte(probe[:n], 0) >= 0 {
			file.Close()
			return nil, errors.New("binary log format is not supported")
		}
	}
	return file, nil
}

// Preserve the existing admin-only CoreOps audit boundary even when the data
// directory is deployed under the host's log root. Inode comparison covers aliases.
func (a *API) isCoreOpsAudit(file *os.File) bool {
	if a.auditLogPath == "" {
		return false
	}
	private, err := os.Stat(a.auditLogPath)
	if err != nil {
		return false
	}
	info, err := file.Stat()
	return err == nil && os.SameFile(info, private)
}
func (a *API) logSources(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	catalog := hostLogCatalog{Files: []hostLogSource{}, Warnings: []string{}}
	root, err := os.OpenRoot(a.hostLogRoot())
	if err != nil {
		catalog.Warnings = append(catalog.Warnings, "The host log directory is unavailable to the API service account.")
		writeJSON(w, 200, catalog)
		return
	}
	defer root.Close()
	visited := 0
	limited := false
	var walk func(string, int)
	walk = func(dir string, depth int) {
		if depth > 8 || visited >= 5000 || len(catalog.Files) >= 2000 || r.Context().Err() != nil {
			limited = true
			return
		}
		f, err := root.OpenFile(dir, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
		if err != nil {
			catalog.Warnings = append(catalog.Warnings, "Cannot list host log directory: "+dir)
			return
		}
		nodes, err := f.ReadDir(5001 - visited)
		f.Close()
		if err != nil && err != io.EOF {
			catalog.Warnings = append(catalog.Warnings, "Some host log directory entries could not be read: "+dir)
		}
		for _, node := range nodes {
			visited++
			if visited > 5000 || len(catalog.Files) >= 2000 {
				limited = true
				return
			}
			if strings.HasPrefix(node.Name(), ".") || node.Name() == "journal" || node.Type()&os.ModeSymlink != 0 {
				continue
			}
			name := path.Join(dir, node.Name())
			if node.IsDir() {
				walk(name, depth+1)
				continue
			}
			if !node.Type().IsRegular() || !validHostLogPath(name) {
				continue
			}
			log, openErr := openHostLog(root, name)
			readable := openErr == nil
			if readable {
				private := a.isCoreOpsAudit(log)
				log.Close()
				if private {
					continue
				}
			}
			catalog.Files = append(catalog.Files, hostLogSource{Path: name, Name: "/var/log/" + name, Readable: readable, Archive: strings.HasSuffix(name, ".gz")})
		}
	}
	walk(".", 0)
	if limited {
		catalog.Warnings = append(catalog.Warnings, "The host log catalog reached its discovery limit; additional paths can be queried through the confined log API.")
	}
	slices.SortFunc(catalog.Files, func(a, b hostLogSource) int { return strings.Compare(a.Path, b.Path) })
	writeJSON(w, 200, catalog)
}

type fileLogCursor struct {
	Offset int64  `json:"offset"`
	Inode  uint64 `json:"inode"`
	Device uint64 `json:"device"`
}

func encodeFileLogCursor(c fileLogCursor) string {
	data, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(data)
}
func decodeFileLogCursor(raw string) (fileLogCursor, error) {
	var cursor fileLogCursor
	if len(raw) > 512 {
		return cursor, errors.New("invalid log cursor")
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return cursor, err
	}
	err = json.Unmarshal(data, &cursor)
	if cursor.Offset < 0 {
		err = errors.New("invalid log offset")
	}
	return cursor, err
}

func (a *API) fileLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	name := r.URL.Query().Get("file")
	if !validHostLogPath(name) {
		writeJSON(w, 400, ErrorResponse{Error: "invalid host log path"})
		return
	}
	limit := 500
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 1000 {
			writeJSON(w, 400, ErrorResponse{Error: "limit must be between 1 and 1000"})
			return
		}
		limit = n
	}
	var cursor *fileLogCursor
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		decoded, err := decodeFileLogCursor(raw)
		if err != nil {
			writeJSON(w, 400, ErrorResponse{Error: "invalid log cursor"})
			return
		}
		cursor = &decoded
	}
	root, err := os.OpenRoot(a.hostLogRoot())
	if err != nil {
		writeJSON(w, 502, ErrorResponse{Error: "Host log directory is unavailable"})
		return
	}
	defer root.Close()
	file, err := openHostLog(root, name)
	if err != nil {
		status := http.StatusBadGateway
		if os.IsNotExist(err) {
			status = 404
		}
		if os.IsPermission(err) {
			status = 403
		}
		writeJSON(w, status, ErrorResponse{Error: "Host log is unavailable, unreadable, or is not a regular text log; check the API service account's permissions"})
		return
	}
	defer file.Close()
	if a.isCoreOpsAudit(file) {
		writeJSON(w, 403, ErrorResponse{Error: "CoreOps audit logs require the administrator-only audit endpoint"})
		return
	}
	info, err := file.Stat()
	if err != nil {
		writeJSON(w, 502, ErrorResponse{Error: "Cannot inspect host log"})
		return
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		writeJSON(w, 502, ErrorResponse{Error: "Host log identity unavailable"})
		return
	}
	if cursor != nil && (cursor.Inode != stat.Ino || cursor.Device != uint64(stat.Dev) || (!strings.HasSuffix(name, ".gz") && cursor.Offset > info.Size())) {
		writeJSON(w, 409, ErrorResponse{Error: "This log rotated or was truncated. Return to latest to start a new read."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	var page LogsOverview
	if strings.HasSuffix(name, ".gz") {
		page, err = readGzipLogPage(ctx, file, name, limit, cursor, stat)
	} else {
		page, err = readTextLogPage(ctx, file, name, limit, cursor, stat, info.Size())
	}
	if err != nil {
		writeJSON(w, 502, ErrorResponse{Error: "Host log read failed or exceeded its deadline. The archive may be damaged or the file may have rotated."})
		return
	}
	writeJSON(w, 200, page)
}
func textLogEntry(line, name string) LogEntry {
	line = strings.TrimSuffix(line, "\r")
	stamp, message := splitDockerLogTimestamp(line)

	return LogEntry{Timestamp: stamp, Level: inferLogLevel(line), Source: "/var/log/" + name, Message: message, Stream: "file"}
}
func readTextLogPage(ctx context.Context, file *os.File, name string, limit int, cursor *fileLogCursor, stat *syscall.Stat_t, size int64) (LogsOverview, error) {
	page := LogsOverview{Entries: []LogEntry{}, Sources: []string{"/var/log/" + name}, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano), HistoryOrder: "older"}
	end := size
	if cursor != nil {
		end = cursor.Offset
	}
	start := max(int64(0), end-maxLogBytes)
	data := make([]byte, int(end-start))
	n, err := file.ReadAt(data, start)
	if err != nil && err != io.EOF {
		return page, err
	}
	data = data[:n]
	if ctx.Err() != nil {
		return page, ctx.Err()
	}
	var preceding [1]byte
	if start > 0 {
		_, _ = file.ReadAt(preceding[:], start-1)
	}
	if start > 0 && preceding[0] != '\n' {
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			start += int64(i + 1)
			data = data[i+1:]
		} else {
			page.Truncated = true
			page.NextCursor = encodeFileLogCursor(fileLogCursor{Offset: start, Inode: stat.Ino, Device: uint64(stat.Dev)})
			return page, nil
		}
	}
	endIndex := len(data)
	if endIndex > 0 && data[endIndex-1] == '\n' {
		endIndex--
	}
	oldest := start + int64(endIndex)
	for endIndex >= 0 && len(data) > 0 && len(page.Entries) < limit {
		begin := bytes.LastIndexByte(data[:endIndex], '\n') + 1
		line := data[begin:endIndex]
		if len(line) > maxLogLine {
			line = line[:maxLogLine]
			page.Truncated = true
		}
		page.Entries = append(page.Entries, textLogEntry(string(line), name))
		oldest = start + int64(begin)
		endIndex = begin - 1
	}
	slices.Reverse(page.Entries)
	if oldest > 0 {
		page.NextCursor = encodeFileLogCursor(fileLogCursor{Offset: oldest, Inode: stat.Ino, Device: uint64(stat.Dev)})
	}
	return page, nil
}

type logContextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r logContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}
func readGzipLogPage(ctx context.Context, file *os.File, name string, limit int, cursor *fileLogCursor, stat *syscall.Stat_t) (LogsOverview, error) {
	page := LogsOverview{Entries: []LogEntry{}, Sources: []string{"/var/log/" + name}, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano), HistoryOrder: "newer", Warnings: []string{"Compressed archives are read from oldest to newest. Each page replays decompression to its position and is subject to a 10-second deadline."}}
	archive, err := gzip.NewReader(logContextReader{ctx, file})
	if err != nil {
		return page, err
	}
	defer archive.Close()
	reader := bufio.NewReaderSize(logContextReader{ctx, archive}, maxLogLine)
	offset := int64(0)
	if cursor != nil {
		offset = cursor.Offset
		if _, err = io.CopyN(io.Discard, reader, offset); err != nil {
			return page, err
		}
	}
	consumed := 0
	for len(page.Entries) < limit && consumed < maxLogBytes {
		var message []byte
		total := 0
		for {
			part, readErr := reader.ReadSlice('\n')
			total += len(part)
			offset += int64(len(part))
			consumed += len(part)
			if len(message) < maxLogLine {
				message = append(message, part[:min(len(part), maxLogLine-len(message))]...)
			}
			if readErr == bufio.ErrBufferFull {
				page.Truncated = true
				continue
			}
			if readErr != nil && readErr != io.EOF {
				return page, readErr
			}
			if total == 0 {
				return page, nil
			}
			break
		}
		if total > maxLogLine {
			page.Truncated = true
		}
		page.Entries = append(page.Entries, textLogEntry(strings.TrimSuffix(string(message), "\n"), name))
	}
	if _, err := reader.Peek(1); err == nil {
		page.NextCursor = encodeFileLogCursor(fileLogCursor{Offset: offset, Inode: stat.Ino, Device: uint64(stat.Dev)})
	} else if err != io.EOF {
		return page, fmt.Errorf("archive: %w", err)
	}
	return page, nil
}
