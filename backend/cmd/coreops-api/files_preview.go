package main

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"unicode"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

const textPreviewLimit = 256 * 1024
const imagePreviewLimit = 8 * 1024 * 1024

type filePreview struct {
	Path      string `json:"path"`
	Kind      string `json:"kind"`
	MediaType string `json:"mediaType,omitempty"`
	Content   string `json:"content,omitempty"`
	Size      int64  `json:"size"`
	Truncated bool   `json:"truncated"`
	Reason    string `json:"reason,omitempty"`
}

// Content is returned only as JSON. HTML, SVG and scripts are never served as
// active documents; the client renders text and an allowlist of raster images.
func (f *FileExplorer) preview(dataDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		q := r.URL.Query()
		relative, err := filePath(q.Get("path"))
		if err != nil || relative == "." || len(q.Get("path")) > 4096 || len(q.Get("version")) != 64 || len(q) != 2 || len(q["path"]) != 1 || len(q["version"]) != 1 {
			writeError(w, 400, errors.New("provide a file path and version from a fresh directory listing"))
			return
		}
		setAuditDetail(r, "preview file "+logicalPath(relative))
		select {
		case f.previews <- struct{}{}:
			defer func() { <-f.previews }()
		default:
			writeError(w, 429, errors.New("too many file previews; try again shortly"))
			return
		}
		file, err := f.openPreview(relative)
		if err != nil {
			fileError(w, err)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			fileError(w, err)
			return
		}
		if !info.Mode().IsRegular() {
			writeError(w, 400, errors.New("only regular files can be previewed"))
			return
		}
		if f.privateTerminalFile(relative, info) {
			writeError(w, 403, errors.New("terminal password storage cannot be previewed"))
			return
		}
		for _, name := range []string{usersFileName, sessionsFileName, ".identity.lock", auditFileName} {
			if protected, e := os.Stat(filepath.Join(dataDir, name)); e == nil && os.SameFile(info, protected) {
				writeError(w, 403, errors.New("CoreOps identity and audit files cannot be previewed"))
				return
			}
		}
		if fileVersion(info) != q.Get("version") {
			writeError(w, 409, errors.New("file changed since it was listed; refresh the folder before opening it"))
			return
		}
		data, err := io.ReadAll(io.LimitReader(file, textPreviewLimit+1))
		if err != nil {
			fileError(w, err)
			return
		}
		result := filePreview{Path: logicalPath(relative), Kind: "unavailable", Size: info.Size()}
		media := http.DetectContentType(data)
		switch media {
		case "image/png", "image/jpeg", "image/gif", "image/webp":
			if info.Size() > imagePreviewLimit {
				result.Reason = "Image exceeds the 8 MiB preview limit. Download it to view the full file."
				break
			}
			rest, e := io.ReadAll(io.LimitReader(file, imagePreviewLimit+1-int64(len(data))))
			if e != nil {
				fileError(w, e)
				return
			}
			data = append(data, rest...)
			if len(data) > imagePreviewLimit {
				result.Reason = "Image exceeds the 8 MiB preview limit."
				break
			}
			result.Kind, result.MediaType, result.Content = "image", media, base64.StdEncoding.EncodeToString(data)
		default:
			result.Truncated = len(data) > textPreviewLimit
			if result.Truncated {
				data = data[:textPreviewLimit]
				// Do not split a multi-byte rune at the preview boundary.
				for len(data) > 0 && !utf8.Valid(data) && len(data) > textPreviewLimit-utf8.UTFMax {
					data = data[:len(data)-1]
				}
			}
			text := string(data)
			if utf8.Valid(data) && !strings.ContainsFunc(text, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' && r != '\f' }) {
				result.Kind, result.MediaType, result.Content = "text", "text/plain", text
			} else {
				result.Reason = "Preview is unavailable for this binary or non-UTF-8 file. Download it to open with a compatible application."
			}
		}
		after, err := file.Stat()
		if err != nil || fileVersion(after) != fileVersion(info) {
			writeError(w, 409, errors.New("file changed while reading; refresh the folder before opening it"))
			return
		}
		if r.Context().Err() != nil {
			return
		}
		writeJSON(w, 200, result)
	}
}

func (f *FileExplorer) openPreview(relative string) (*os.File, error) {
	parent, err := f.root.OpenRoot(path.Dir(relative))
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	dir, err := parent.Open(".")
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	// os.Root intentionally resolves safe links, even with O_NOFOLLOW. Pin the
	// confined parent and use openat to reject the final link atomically.
	fd, err := unix.Openat(int(dir.Fd()), path.Base(relative), os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), path.Base(relative)), nil
}
