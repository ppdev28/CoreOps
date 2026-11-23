package main

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// Optional production assets share the API listener. Root confines symlinks and
// traversal; only regular, non-hidden files are public, never directory listings.
func withWeb(api http.Handler, directory string) (http.Handler, func() error, error) {
	if directory == "" {
		return api, func() error { return nil }, nil
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, nil, err
	}
	index, err := root.Stat("index.html")
	if err != nil || !index.Mode().IsRegular() {
		root.Close()
		return nil, nil, errors.New("web directory needs a regular index.html")
	}
	files := http.FileServerFS(root.FS())
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/metrics" || strings.HasPrefix(r.URL.Path, "/metrics/") {
			api.ServeHTTP(w, r)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if !fs.ValidPath(name) {
			http.NotFound(w, r)
			return
		}
		for _, part := range strings.Split(name, "/") {
			if strings.HasPrefix(part, ".") {
				http.NotFound(w, r)
				return
			}
		}
		info, err := root.Stat(name)
		if err != nil && os.IsNotExist(err) && path.Ext(name) == "" && strings.Contains(r.Header.Get("Accept"), "text/html") {
			name = "index.html"
			info, err = root.Stat(name)
		}
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		// FileServer's index.html redirect is undesirable for SPA navigation.
		if name == "index.html" {
			f, err := root.Open(name)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			defer f.Close()
			http.ServeContent(w, r, "index.html", info.ModTime(), f)
			return
		}
		files.ServeHTTP(w, r)
	})
	return handler, root.Close, nil
}
