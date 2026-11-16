package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/unix"
)

// Versions identify the listing's inode and metadata, without exposing host inode
// numbers. Changed/replaced files require a fresh listing and confirmation.
func fileVersion(info fs.FileInfo) string {
	if !info.Mode().IsRegular() {
		return ""
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return ""
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d:%d:%d:%d:%d", st.Dev, st.Ino, info.Size(), info.ModTime().UnixNano(), info.Mode())))
	return hex.EncodeToString(sum[:])
}
func (f *FileExplorer) remove(dataDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		var req struct {
			Path    string `json:"path"`
			Version string `json:"version"`
		}
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
		dec.DisallowUnknownFields()
		if r.URL.RawQuery != "" || dec.Decode(&req) != nil || dec.Decode(&struct{}{}) != io.EOF || len(req.Path) > 4096 || len(req.Version) != 64 {
			writeError(w, 400, errors.New("provide path and the version from a fresh directory listing"))
			return
		}
		relative, err := filePath(req.Path)
		if err != nil || relative == "." {
			writeError(w, 400, errors.New("invalid file path"))
			return
		}
		setAuditDetail(r, "delete file "+logicalPath(relative))
		// Pin the parent descriptor before inspection/unlink so ancestor renames cannot
		// redirect deletion. os.Root also rejects symlink escapes from a custom root.
		parent, err := f.root.OpenRoot(path.Dir(relative))
		if err != nil {
			fileError(w, err)
			return
		}
		defer parent.Close()
		name := path.Base(relative)
		info, err := parent.Lstat(name)
		if err != nil {
			fileError(w, err)
			return
		}
		if !info.Mode().IsRegular() {
			writeError(w, 400, errors.New("only regular files can be deleted; folders, symbolic links and devices are excluded"))
			return
		}
		if req.Version != fileVersion(info) {
			writeError(w, 409, errors.New("file changed since it was listed; refresh and review it before deleting"))
			return
		}
		// Protect live identity/lock/audit files even when reached through hard links.
		for _, protected := range []string{usersFileName, sessionsFileName, ".identity.lock", auditFileName} {
			if p, e := os.Stat(filepath.Join(dataDir, protected)); e == nil && os.SameFile(info, p) {
				writeError(w, 403, errors.New("CoreOps identity and audit files cannot be deleted through the explorer"))
				return
			}
		}
		if r.Context().Err() != nil {
			return
		}
		// Unlike os.Root.Remove, unlinkat with flags=0 never retries as rmdir:
		// even a concurrent replacement with an empty directory cannot delete it.
		dir, err := parent.Open(".")
		if err != nil {
			fileError(w, err)
			return
		}
		defer dir.Close()
		if err = unix.Unlinkat(int(dir.Fd()), name, 0); err != nil {
			if errors.Is(err, syscall.EISDIR) {
				writeError(w, 409, errors.New("file changed; refresh and review it before deleting"))
				return
			}
			if errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.EROFS) {
				writeError(w, 403, errors.New("read-only filesystem or service user lacks delete permission"))
				return
			}
			fileError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "path": logicalPath(relative)})
	}
}
