package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

type fileFixture struct {
	files       *FileExplorer
	auth        *AuthStore
	handler     http.Handler
	root, token string
}

func newFileFixture(t *testing.T) *fileFixture {
	t.Helper()
	root := t.TempDir()
	files, err := newFileExplorer(root, 1024, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(files.close)
	auth := newTestStore(t)
	if err := auth.AddUser("admin", RoleAdmin, testPassword); err != nil {
		t.Fatal(err)
	}
	token, _, _, err := auth.Login("admin", testPassword, "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	api := &API{files: files}
	audit := NewAuditLog(t.TempDir())
	return &fileFixture{files, auth, withAudit(audit, api.routes(auth, audit)), root, token}
}
func (f *fileFixture) request(method, target string, body io.Reader, token string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, body)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, request)
	return response
}
func (f *fileFixture) ticket(t *testing.T, path string) string {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{"path": path})
	response := f.request("POST", "/api/v1/files/download-ticket", bytes.NewReader(payload), f.token)
	if response.Code != 200 {
		t.Fatalf("ticket: %d %s", response.Code, response.Body.String())
	}
	var output map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &output); err != nil {
		t.Fatal(err)
	}
	return output["ticket"]
}
func TestFileListingFiltersPaginationAndRoles(t *testing.T) {
	f := newFileFixture(t)
	for _, name := range []string{"b.txt", "a.txt", ".secret"} {
		if err := os.WriteFile(filepath.Join(f.root, name), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(f.root, "folder"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, role := range []Role{RoleViewer, RoleOperator} {
		name := string(role)
		if err := f.auth.AddUser(name, role, testPassword); err != nil {
			t.Fatal(err)
		}
		token, _, _, _ := f.auth.Login(name, testPassword, "127.0.0.1")
		for _, route := range []struct{ method, path string }{{"GET", "/api/v1/files"}, {"POST", "/api/v1/files/upload?name=x"}, {"POST", "/api/v1/files/download-ticket"}} {
			if response := f.request(route.method, route.path, nil, token); response.Code != 403 {
				t.Errorf("%s %s: got %d", role, route.path, response.Code)
			}
		}
	}
	if response := f.request("GET", "/api/v1/files", nil, ""); response.Code != 401 {
		t.Errorf("unauthenticated: %d", response.Code)
	}
	response := f.request("GET", "/api/v1/files?limit=2", nil, f.token)
	var listing fileListing
	if err := json.Unmarshal(response.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || listing.Total != 3 || len(listing.Entries) != 2 || listing.Entries[0].Name != "folder" || listing.Entries[1].Name != "a.txt" {
		t.Fatalf("bad listing: %d %+v", response.Code, listing)
	}
	response = f.request("GET", "/api/v1/files?hidden=true&q=SECRET", nil, f.token)
	json.Unmarshal(response.Body.Bytes(), &listing)
	if listing.Total != 1 || listing.Entries[0].Name != ".secret" {
		t.Fatal("hidden/search filters failed")
	}
	response = f.request("GET", "/api/v1/files?offset=9999", nil, f.token)
	json.Unmarshal(response.Body.Bytes(), &listing)
	if listing.Offset != 3 || len(listing.Entries) != 0 {
		t.Fatalf("out of range page: %+v", listing)
	}
}
func TestFileUploadDownloadRoundTripAndNoOverwrite(t *testing.T) {
	f := newFileFixture(t)
	content := []byte{0, 255, 1, 2, 3, 0, 17}
	name := "foto ñ #?.bin"
	target := "/api/v1/files/upload?" + url.Values{"path": {"/"}, "name": {name}}.Encode()
	if response := f.request("POST", target, bytes.NewReader(content), f.token); response.Code != 201 {
		t.Fatalf("upload: %d %s", response.Code, response.Body.String())
	}
	if response := f.request("POST", target, strings.NewReader("replace"), f.token); response.Code != 409 {
		t.Fatalf("overwrite: %d", response.Code)
	}
	ticket := f.ticket(t, "/"+name)
	response := f.request("GET", "/api/v1/files/download?ticket="+ticket, nil, "")
	if response.Code != 200 || !bytes.Equal(response.Body.Bytes(), content) {
		t.Fatalf("download: %d %q", response.Code, response.Body.Bytes())
	}
	if !strings.HasPrefix(response.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatal("attachment disposition missing")
	}
	if response := f.request("GET", "/api/v1/files/download?ticket="+ticket, nil, ""); response.Code != 401 {
		t.Fatal("ticket could be reused")
	}
	stat, _ := os.Stat(filepath.Join(f.root, name))
	if stat.Mode().Perm() != 0600 {
		t.Fatalf("upload permissions: %o", stat.Mode().Perm())
	}
	entries, _ := os.ReadDir(f.root)
	if len(entries) != 1 {
		t.Fatalf("temporary upload files remain: %v", entries)
	}
}
func TestFileTraversalAndSymlinkEscape(t *testing.T) {
	f := newFileFixture(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(f.root, "escape")); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/../secret", "/escape/secret", "/escape"} {
		response := f.request("GET", "/api/v1/files?path="+url.QueryEscape(path), nil, f.token)
		if response.Code == 200 {
			t.Errorf("listed outside root: %s", path)
		}
		payload, _ := json.Marshal(map[string]string{"path": path})
		if response := f.request("POST", "/api/v1/files/download-ticket", bytes.NewReader(payload), f.token); response.Code == 200 {
			t.Errorf("download outside root: %s", path)
		}
	}
	if response := f.request("POST", "/api/v1/files/upload?path=/escape&name=bad", strings.NewReader("bad"), f.token); response.Code == 201 {
		t.Fatal("uploaded outside root")
	}
	for _, name := range []string{"../bad", "..", "a/b", "a\\b", ".coreops-upload-evil", "bad\nname"} {
		if response := f.request("POST", "/api/v1/files/upload?name="+url.QueryEscape(name), strings.NewReader("bad"), f.token); response.Code != 400 {
			t.Errorf("invalid name %q: %d", name, response.Code)
		}
	}
	if _, err := os.Stat(filepath.Join(outside, "bad")); !os.IsNotExist(err) {
		t.Fatal("escaped root")
	}
}

type brokenUpload struct{ sent bool }

func (b *brokenUpload) Read(buffer []byte) (int, error) {
	if b.sent {
		return 0, errors.New("connection reset")
	}
	b.sent = true
	return copy(buffer, "partial"), nil
}
func TestFileUploadLimitAndInterruptedCleanup(t *testing.T) {
	f := newFileFixture(t)
	for _, body := range []io.Reader{strings.NewReader(strings.Repeat("x", 1025)), &brokenUpload{}} {
		response := f.request("POST", "/api/v1/files/upload?name=unfinished", body, f.token)
		if response.Code != 413 && response.Code != 400 {
			t.Fatalf("unexpected failure status %d %s", response.Code, response.Body.String())
		}
		entries, _ := os.ReadDir(f.root)
		if len(entries) != 0 {
			t.Fatalf("failed upload left files: %v", entries)
		}
	}
	// Unknown-length uploads must be limited too.
	request := httptest.NewRequest("POST", "/api/v1/files/upload?name=chunked", io.NopCloser(strings.NewReader(strings.Repeat("x", 1025))))
	request.ContentLength = -1
	request.Header.Set("Authorization", "Bearer "+f.token)
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, request)
	if response.Code != 413 {
		t.Fatalf("chunked upload limit: %d", response.Code)
	}
	entries, _ := os.ReadDir(f.root)
	if len(entries) != 0 {
		t.Fatal("oversized upload was published")
	}
}
func TestFileTicketsExpiryRevocationAndSpecialFiles(t *testing.T) {
	f := newFileFixture(t)
	os.WriteFile(filepath.Join(f.root, "file"), []byte("data"), 0600)
	if err := syscall.Mkfifo(filepath.Join(f.root, "pipe"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/", "/pipe"} {
		payload, _ := json.Marshal(map[string]string{"path": path})
		if response := f.request("POST", "/api/v1/files/download-ticket", bytes.NewReader(payload), f.token); response.Code != 400 {
			t.Fatalf("special file: %s %d", path, response.Code)
		}
	}
	ticket := f.ticket(t, "/file")
	f.files.mu.Lock()
	value := f.files.tickets[ticket]
	value.expires = time.Now().Add(-time.Second)
	f.files.tickets[ticket] = value
	f.files.mu.Unlock()
	if response := f.request("GET", "/api/v1/files/download?ticket="+ticket, nil, ""); response.Code != 401 {
		t.Fatal("expired ticket accepted")
	}
	ticket = f.ticket(t, "/file")
	if response := f.request("POST", "/api/v1/auth/logout", nil, f.token); response.Code != 200 {
		t.Fatal("logout failed")
	}
	if response := f.request("GET", "/api/v1/files/download?ticket="+ticket, nil, ""); response.Code != 401 {
		t.Fatal("revoked session ticket accepted")
	}
}
func TestConcurrentUploadsNeverOverwrite(t *testing.T) {
	f := newFileFixture(t)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for _, data := range []string{"first", "second"} {
		wg.Add(1)
		go func(content string) {
			defer wg.Done()
			codes <- f.request("POST", "/api/v1/files/upload?name=same", strings.NewReader(content), f.token).Code
		}(data)
	}
	wg.Wait()
	close(codes)
	success, conflict := 0, 0
	for code := range codes {
		if code == 201 {
			success++
		}
		if code == 409 {
			conflict++
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("success=%d conflict=%d", success, conflict)
	}
	content, _ := os.ReadFile(filepath.Join(f.root, "same"))
	if string(content) != "first" && string(content) != "second" {
		t.Fatalf("corrupted upload: %q", content)
	}
}

func TestDownloadTicketPinsTheSelectedFile(t *testing.T) {
	f := newFileFixture(t)
	original := filepath.Join(f.root, "selected")
	if err := os.WriteFile(original, []byte("selected contents"), 0600); err != nil {
		t.Fatal(err)
	}
	ticket := f.ticket(t, "/selected")
	if err := os.Rename(original, filepath.Join(f.root, "moved")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(original, []byte("replacement contents"), 0600); err != nil {
		t.Fatal(err)
	}
	response := f.request("GET", "/api/v1/files/download?ticket="+ticket, nil, "")
	if response.Code != 200 || response.Body.String() != "selected contents" {
		t.Fatalf("ticket target changed: %d %q", response.Code, response.Body.String())
	}
}
