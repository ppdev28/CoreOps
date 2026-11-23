package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProductionWebConfinementAndAPIBoundary(t *testing.T) {
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "assets"), 0755)
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>CoreOps</html>"), 0644)
	os.WriteFile(filepath.Join(dir, "assets", "app-hash.js"), []byte("export const ok=true"), 0644)
	os.WriteFile(filepath.Join(dir, ".env"), []byte("never-public"), 0600)
	secret := filepath.Join(t.TempDir(), "secret.txt")
	os.WriteFile(secret, []byte("never-public"), 0600)
	os.Symlink(secret, filepath.Join(dir, "secret.txt"))
	h, closeWeb, err := withWeb(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "API boundary", http.StatusUnauthorized)
	}), dir)
	if err != nil {
		t.Fatal(err)
	}
	defer closeWeb()
	for _, tc := range []struct {
		method, path string
		code         int
		body         string
	}{
		{"GET", "/", 200, "CoreOps"}, {"HEAD", "/", 200, ""},
		{"GET", "/security", 200, "CoreOps"}, {"GET", "/index.html", 200, "CoreOps"},
		{"GET", "/assets/app-hash.js", 200, "export"}, {"GET", "/assets/missing.js", 404, ""},
		{"GET", "/assets/", 404, ""}, {"GET", "/.env", 404, ""}, {"GET", "/secret.txt", 404, ""},
		{"GET", "/../secret.txt", 404, ""}, {"POST", "/", 405, ""},
		{"GET", "/api/v1/missing", 401, "API boundary"}, {"GET", "/metrics", 401, "API boundary"},
	} {
		r := httptest.NewRequest(tc.method, tc.path, nil)
		r.Header.Set("Accept", "text/html")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.code || !strings.Contains(w.Body.String(), tc.body) || strings.Contains(w.Body.String(), "never-public") {
			t.Errorf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body.String())
		}
		if tc.path == "/" && w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("stale HTML cache")
		}
		if tc.path == "/assets/app-hash.js" && !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
			t.Fatal("asset cache")
		}
	}
	if _, _, err := withWeb(h, t.TempDir()); err == nil {
		t.Fatal("missing UI accepted")
	}
}
