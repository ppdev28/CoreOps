package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

const fileUploadPrefix = ".coreops-upload-"
const maxDirectoryEntries = 50000

// FileExplorer owns a descriptor-based root. os.Root keeps path resolution inside
// this directory even when another process changes directories or symlinks.
type FileExplorer struct {
	root      *os.Root
	rootPath  string
	maxUpload int64
	timeout   time.Duration
	mu        sync.Mutex
	tickets   map[string]fileTicket
	stop      chan struct{}
	previews  chan struct{}
}
type fileTicket struct {
	file    *os.File
	name    string
	session string
	expires time.Time
}
type fileEntry struct {
	Name     string    `json:"name"`
	Path     string    `json:"path"`
	Kind     string    `json:"kind"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
	Mode     string    `json:"mode"`
	Version  string    `json:"version,omitempty"`
}
type fileListing struct {
	Path           string      `json:"path"`
	Root           string      `json:"root"`
	Entries        []fileEntry `json:"entries"`
	Total          int         `json:"total"`
	Offset         int         `json:"offset"`
	Limit          int         `json:"limit"`
	MaxUploadBytes int64       `json:"maxUploadBytes"`
}

func newFileExplorer(rootPath string, maxUpload int64, timeout time.Duration) (*FileExplorer, error) {
	absolute, err := filepath.Abs(rootPath)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(absolute)
	if err != nil {
		return nil, err
	}
	f := &FileExplorer{root: root, rootPath: absolute, maxUpload: maxUpload, timeout: timeout, tickets: make(map[string]fileTicket), stop: make(chan struct{}), previews: make(chan struct{}, 4)}
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				f.mu.Lock()
				f.expireTickets()
				f.mu.Unlock()
			case <-f.stop:
				return
			}
		}
	}()
	return f, nil
}
func (f *FileExplorer) close() {
	close(f.stop)
	f.mu.Lock()
	defer f.mu.Unlock()
	for key, ticket := range f.tickets {
		ticket.file.Close()
		delete(f.tickets, key)
	}
	f.root.Close()
}
func (f *FileExplorer) expireTickets() {
	for key, ticket := range f.tickets {
		if time.Now().After(ticket.expires) {
			ticket.file.Close()
			delete(f.tickets, key)
		}
	}
}

// API paths are relative to the configured root, expressed with a leading slash.
// Reject traversal rather than silently normalizing it into a different target.
func filePath(raw string) (string, error) {
	if strings.ContainsAny(raw, "\\\x00") {
		return "", errors.New("invalid path")
	}
	for _, part := range strings.Split(raw, "/") {
		if part == ".." || strings.HasPrefix(part, fileUploadPrefix) {
			return "", errors.New("path is not accessible")
		}
	}
	clean := strings.TrimPrefix(path.Clean("/"+raw), "/")
	if clean == "" {
		clean = "."
	}
	return clean, nil
}
func fileName(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "/\\\x00\r\n") && !strings.HasPrefix(name, fileUploadPrefix) && len(name) <= 255
}
func logicalPath(relative string) string {
	if relative == "." {
		return "/"
	}
	return "/" + relative
}
func fileError(w http.ResponseWriter, err error) {
	status, message := http.StatusInternalServerError, "filesystem operation failed"
	switch {
	case errors.Is(err, fs.ErrPermission), errors.Is(err, syscall.ELOOP), errors.Unwrap(err) != nil && errors.Unwrap(err).Error() == "path escapes from parent":
		status, message = http.StatusForbidden, "access denied or unsafe symbolic link"
	case errors.Is(err, fs.ErrNotExist):
		status, message = http.StatusNotFound, "file or directory no longer exists"
	case errors.Is(err, fs.ErrExist):
		status, message = http.StatusConflict, "a file with this name already exists; rename it before uploading"
	case errors.Is(err, syscall.ENOTDIR):
		status, message = http.StatusBadRequest, "path is not a directory"
	case errors.Is(err, syscall.ENOSPC), errors.Is(err, syscall.EDQUOT):
		status, message = http.StatusInsufficientStorage, "not enough space on the server"
	}
	writeError(w, status, errors.New(message))
}
func (f *FileExplorer) list(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	relative, err := filePath(r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, 400, err)
		return
	}
	setAuditDetail(r, "list "+logicalPath(relative))
	dir, err := f.root.OpenFile(relative, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		fileError(w, err)
		return
	}
	defer dir.Close()
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	query := strings.ToLower(r.URL.Query().Get("q"))
	hidden := r.URL.Query().Get("hidden") == "true"
	entries := make([]fileEntry, 0)
	scanned := 0
	for {
		batch, readErr := dir.ReadDir(256)
		if readErr != nil && readErr != io.EOF {
			fileError(w, readErr)
			return
		}
		for _, entry := range batch {
			scanned++
			if scanned > maxDirectoryEntries {
				writeError(w, 422, errors.New("directory exceeds 50,000 entries; open a smaller directory"))
				return
			}
			name := entry.Name()
			if strings.HasPrefix(name, fileUploadPrefix) || (!hidden && strings.HasPrefix(name, ".")) || !strings.Contains(strings.ToLower(name), query) {
				continue
			}
			info, err := entry.Info()
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			if err != nil {
				fileError(w, err)
				return
			}
			kind := "special"
			switch {
			case info.IsDir():
				kind = "directory"
			case info.Mode().IsRegular():
				kind = "file"
			case info.Mode()&os.ModeSymlink != 0:
				kind = "symlink"
			}
			entries = append(entries, fileEntry{Name: name, Path: logicalPath(path.Join(relative, name)), Kind: kind, Size: info.Size(), Modified: info.ModTime(), Mode: info.Mode().String(), Version: fileVersion(info)})
		}
		if r.Context().Err() != nil {
			return
		}
		if readErr == io.EOF {
			break
		}
	}
	sortBy, descending := r.URL.Query().Get("sort"), r.URL.Query().Get("order") == "desc"
	slices.SortFunc(entries, func(a, b fileEntry) int {
		if (a.Kind == "directory") != (b.Kind == "directory") {
			if a.Kind == "directory" {
				return -1
			}
			return 1
		}
		cmp := 0
		switch sortBy {
		case "size":
			if a.Size < b.Size {
				cmp = -1
			} else if a.Size > b.Size {
				cmp = 1
			}
		case "modified":
			cmp = a.Modified.Compare(b.Modified)
		}
		if cmp == 0 {
			cmp = strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
			if cmp == 0 {
				cmp = strings.Compare(a.Name, b.Name)
			}
		}
		if descending {
			return -cmp
		}
		return cmp
	})
	total := len(entries)
	offset = min(offset, total)
	writeJSON(w, 200, fileListing{Path: logicalPath(relative), Root: f.rootPath, Entries: entries[offset:min(offset+limit, total)], Total: total, Offset: offset, Limit: limit, MaxUploadBytes: f.maxUpload})
}

func (f *FileExplorer) upload(w http.ResponseWriter, r *http.Request) {
	relative, err := filePath(r.URL.Query().Get("path"))
	name := r.URL.Query().Get("name")
	if err != nil || !fileName(name) {
		writeError(w, 400, errors.New("invalid destination path or filename"))
		return
	}
	setAuditDetail(r, "upload "+logicalPath(path.Join(relative, name)))
	if r.ContentLength > f.maxUpload {
		writeError(w, 413, errors.New("file exceeds the upload size limit"))
		return
	}
	// Pin the destination directory for the entire transfer and publish using
	// linkat: a completed upload appears atomically and never replaces a file.
	dir, err := f.root.OpenRoot(relative)
	if err != nil {
		fileError(w, err)
		return
	}
	defer dir.Close()
	dirFile, err := dir.Open(".")
	if err != nil {
		fileError(w, err)
		return
	}
	defer dirFile.Close()
	temporary := fileUploadPrefix + randomFileToken()
	file, err := dir.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		fileError(w, err)
		return
	}
	defer file.Close()
	defer dir.Remove(temporary)
	controller := http.NewResponseController(w)
	_ = controller.SetReadDeadline(time.Now().Add(f.timeout))
	_ = controller.SetWriteDeadline(time.Now().Add(f.timeout))
	r.Body = http.MaxBytesReader(w, r.Body, f.maxUpload)
	_, err = io.Copy(file, r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, 413, errors.New("file exceeds the upload size limit"))
		} else if errors.Is(err, syscall.ENOSPC) || errors.Is(err, syscall.EDQUOT) {
			fileError(w, err)
		} else {
			writeError(w, 400, errors.New("upload interrupted; no file was saved"))
		}
		return
	}
	if r.Context().Err() != nil {
		return
	}
	if err = file.Sync(); err != nil {
		fileError(w, err)
		return
	}
	if err = file.Close(); err != nil {
		fileError(w, err)
		return
	}
	fd := int(dirFile.Fd())
	if err = unix.Linkat(fd, temporary, fd, name, 0); err != nil {
		fileError(w, err)
		return
	}
	writeJSON(w, 201, map[string]string{"path": logicalPath(path.Join(relative, name))})
}
func randomFileToken() string {
	var data [32]byte
	if _, err := rand.Read(data[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(data[:])
}

// Mint a short-lived, single-use capability. The browser/Android save handler
// streams the download directly to disk without putting the file in a JS blob
// or exposing the session token in a URL.
func (f *FileExplorer) downloadTicket(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	var input struct {
		Path string `json:"path"`
	}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		writeError(w, 400, errors.New("invalid download request"))
		return
	}
	relative, err := filePath(input.Path)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	setAuditDetail(r, "download ticket "+logicalPath(relative))
	file, err := f.root.OpenFile(relative, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		fileError(w, err)
		return
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		fileError(w, err)
		return
	}
	if !info.Mode().IsRegular() {
		file.Close()
		writeError(w, 400, errors.New("only regular files can be downloaded"))
		return
	}
	token := randomFileToken()
	f.mu.Lock()
	defer f.mu.Unlock()
	f.expireTickets()
	if len(f.tickets) >= 128 {
		file.Close()
		writeError(w, 429, errors.New("too many pending downloads; try again in a minute"))
		return
	}
	f.tickets[token] = fileTicket{file: file, name: info.Name(), session: bearerToken(r), expires: time.Now().Add(5 * time.Minute)}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]string{"ticket": token})
}
func (f *FileExplorer) download(auth *AuthStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		f.mu.Lock()
		f.expireTickets()
		ticket, ok := f.tickets[r.URL.Query().Get("ticket")]
		if ok {
			delete(f.tickets, r.URL.Query().Get("ticket"))
		}
		f.mu.Unlock()
		if !ok {
			writeError(w, 401, errors.New("download link expired or already used; start a new download"))
			return
		}
		defer ticket.file.Close()
		user, ok := auth.Authenticate(ticket.session)
		if !ok || user.Role != RoleAdmin {
			writeError(w, 401, errors.New("session expired"))
			return
		}
		if entry, ok := r.Context().Value(auditCtxKey).(*auditEntry); ok {
			entry.User = user.Name
			entry.Role = user.Role
		}
		setAuditDetail(r, "download "+ticket.name)
		info, err := ticket.file.Stat()
		if err != nil {
			fileError(w, err)
			return
		}
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(f.timeout))
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": ticket.name}))
		http.ServeContent(w, r, ticket.name, info.ModTime(), ticket.file)
	}
}

func filesUploadLimit() (int64, error) {
	value := envString("COREOPS_FILES_MAX_UPLOAD_BYTES", "10737418240")
	limit, err := strconv.ParseInt(value, 10, 64)
	if err != nil || limit < 1 {
		return 0, fmt.Errorf("invalid COREOPS_FILES_MAX_UPLOAD_BYTES: %q", value)
	}
	return limit, nil
}
