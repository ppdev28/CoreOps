package main

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestFilePreviewContentLimitsConfinementAndAudit(t *testing.T) {
	f := newFileFixture(t)
	request := func(name string) string {
		info, err := os.Stat(filepath.Join(f.root, name))
		if err != nil {
			t.Fatal(err)
		}
		return "/api/v1/files/preview?" + url.Values{"path": {"/" + name}, "version": {fileVersion(info)}}.Encode()
	}
	text := "<script>alert('untrusted')</script>\nhello UTF-8 ñ"
	os.WriteFile(filepath.Join(f.root, "test.html"), []byte(text), 0600)
	target := request("test.html")
	if w := f.request("GET", target, nil, ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
	for _, role := range []Role{RoleViewer, RoleOperator} {
		f.auth.AddUser(string(role), role, testPassword)
		token, _, _, _ := f.auth.Login(string(role), testPassword, "127.0.0.1")
		if w := f.request("GET", target, nil, token); w.Code != 403 {
			t.Fatal(role, w.Code)
		}
	}
	w := f.request("GET", target, nil, f.token)
	var result filePreview
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.Kind != "text" || result.Content != text || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w.Code, w.Body.String())
	}
	os.WriteFile(filepath.Join(f.root, "large.txt"), []byte(strings.Repeat("ñ", textPreviewLimit)), 0600)
	w = f.request("GET", request("large.txt"), nil, f.token)
	json.Unmarshal(w.Body.Bytes(), &result)
	if w.Code != 200 || !result.Truncated || len(result.Content) > textPreviewLimit {
		t.Fatal(w.Code, w.Body.String()[:100])
	}
	os.WriteFile(filepath.Join(f.root, "binary"), []byte{0, 1, 2, 3}, 0600)
	w = f.request("GET", request("binary"), nil, f.token)
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.Kind != "unavailable" {
		t.Fatal(w.Body.String())
	}
	os.WriteFile(filepath.Join(f.root, "test.html"), []byte("changed"), 0600)
	if w = f.request("GET", target, nil, f.token); w.Code != 409 {
		t.Fatal(w.Code)
	}
	os.Symlink("test.html", filepath.Join(f.root, "link"))
	if w = f.request("GET", request("link"), nil, f.token); w.Code != 403 {
		t.Fatal(w.Code)
	}
	syscall.Mkfifo(filepath.Join(f.root, "pipe"), 0600)
	for _, p := range []string{"/pipe", "/../outside"} {
		if w = f.request("GET", "/api/v1/files/preview?"+url.Values{"path": {p}, "version": {strings.Repeat("a", 64)}}.Encode(), nil, f.token); w.Code != 400 {
			t.Fatal(p, w.Code)
		}
	}
	outside := filepath.Join(t.TempDir(), "secret")
	os.WriteFile(outside, []byte("outside"), 0600)
	os.Symlink(filepath.Dir(outside), filepath.Join(f.root, "escape"))
	if w = f.request("GET", "/api/v1/files/preview?"+url.Values{"path": {"/escape/secret"}, "version": {strings.Repeat("a", 64)}}.Encode(), nil, f.token); w.Code == 200 {
		t.Fatal("escaped root")
	}
	os.Link(filepath.Join(f.auth.dir, usersFileName), filepath.Join(f.root, "identity"))
	if w = f.request("GET", request("identity"), nil, f.token); w.Code != 403 {
		t.Fatal(w.Code)
	}
	entries, _ := f.audit.Tail(100)
	found := false
	for _, e := range entries {
		if strings.Contains(e.Detail, "<script>") {
			t.Fatal("content in audit")
		}
		if e.Detail == "preview file /test.html" && e.User == "admin" && e.Status == 200 {
			found = true
		}
	}
	if !found {
		t.Fatal("missing preview audit")
	}
}

func TestFilePreviewRasterLimitAndConcurrency(t *testing.T) {
	f := newFileFixture(t)
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	name := filepath.Join(f.root, "image.png")
	if err = os.WriteFile(name, png, 0600); err != nil {
		t.Fatal(err)
	}
	target := func() string {
		info, err := os.Stat(name)
		if err != nil {
			t.Fatal(err)
		}
		return "/api/v1/files/preview?" + url.Values{"path": {"/image.png"}, "version": {fileVersion(info)}}.Encode()
	}
	w := f.request("GET", target(), nil, f.token)
	var result filePreview
	if err = json.Unmarshal(w.Body.Bytes(), &result); err != nil || w.Code != 200 || result.Kind != "image" || result.MediaType != "image/png" || result.Content != base64.StdEncoding.EncodeToString(png) {
		t.Fatal(w.Code, w.Body.String())
	}
	if err = os.Truncate(name, imagePreviewLimit+1); err != nil {
		t.Fatal(err)
	}
	w = f.request("GET", target(), nil, f.token)
	result = filePreview{}
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.Kind != "unavailable" || result.Content != "" || !strings.Contains(result.Reason, "8 MiB") {
		t.Fatal(w.Body.String())
	}
	for range cap(f.files.previews) {
		f.files.previews <- struct{}{}
	}
	w = f.request("GET", target(), nil, f.token)
	for range cap(f.files.previews) {
		<-f.files.previews
	}
	if w.Code != 429 {
		t.Fatal(w.Code)
	}
}
