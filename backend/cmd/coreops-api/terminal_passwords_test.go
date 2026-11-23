package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const pasteTestPassword = " a-test-only-password-é "

func TestTerminalPasswordRolesScopePersistenceAndNoSecretAudit(t *testing.T) {
	auth, audit := adminFixture(t)
	api := &API{}
	h := withAudit(audit, api.routes(auth, audit))
	defer api.terminals.Close()
	path := "/api/v1/terminal/passwords/host"
	body, _ := json.Marshal(map[string]string{"password": pasteTestPassword})
	for _, tc := range []struct {
		token  string
		status int
	}{{"", 401}, {"viewer", 403}, {"operator", 403}, {"admin", 200}} {
		for _, method := range []string{"GET", "POST", "DELETE"} {
			input := ""
			if method == "POST" {
				input = string(body)
			}
			w := adminRequest(h, method, path, tc.token, input)
			if w.Code != tc.status {
				t.Fatal(tc.token, method, w.Code, w.Body.String())
			}
		}
	}
	if w := adminRequest(h, "POST", path, "admin", string(body)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	w := adminRequest(h, "GET", path, "admin", "")
	if strings.Contains(w.Body.String(), pasteTestPassword) || !strings.Contains(w.Body.String(), `"saved":true`) || !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
		t.Fatal(w.Body.String())
	}
	reopened, e := NewAuthStore(auth.dir, time.Hour)
	if e != nil {
		t.Fatal(e)
	}
	saved, plain, e := reopened.passwordOperation("admin", "host", "reveal", "")
	if e != nil || !saved || plain != pasteTestPassword {
		t.Fatal("password lost after reopen", e)
	}
	target := "container-" + strings.Repeat("a", 64)
	if saved, _, e := auth.passwordOperation("admin", target, "status", ""); e != nil || saved {
		t.Fatal("cross-target access", e)
	}
	if e := auth.AddUser("second", RoleAdmin, testPassword); e != nil {
		t.Fatal(e)
	}
	second, _, _, e := auth.Login("second", testPassword, "test-only")
	if e != nil {
		t.Fatal(e)
	}
	if saved, _, e := auth.passwordOperation(second, "host", "status", ""); e != nil || saved {
		t.Fatal("cross-account access", e)
	}
	w = adminRequest(h, "POST", path+"/reveal", "admin", "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var result struct {
		Password string `json:"password"`
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.Password != pasteTestPassword {
		t.Fatal("password whitespace/content changed")
	}
	for _, name := range []string{terminalPasswordFile, auditFileName} {
		data, e := os.ReadFile(filepath.Join(auth.dir, name))
		if e != nil {
			t.Fatal(e)
		}
		if strings.Contains(string(data), pasteTestPassword) {
			t.Fatal("plaintext leaked to storage/audit", name)
		}
	}
	key, e := os.ReadFile(filepath.Join(auth.dir, terminalPasswordKeyFile))
	if e != nil || len(key) != 32 {
		t.Fatal(e)
	}
	for _, name := range []string{terminalPasswordFile, terminalPasswordKeyFile} {
		info, e := os.Stat(filepath.Join(auth.dir, name))
		if e != nil || info.Mode().Perm() != 0600 {
			t.Fatal("unsafe credential permissions", name, e)
		}
	}
	if w := adminRequest(h, "DELETE", path, "admin", ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := adminRequest(h, "POST", path+"/reveal", "admin", ""); w.Code != 404 {
		t.Fatal(w.Code)
	}
	auth.Logout("admin")
	if _, _, e := auth.passwordOperation("admin", "host", "reveal", ""); e != errUserCreationDenied {
		t.Fatal("revoked session read credential", e)
	}
}
func TestTerminalPasswordInvalidInputAndStorageFailClosed(t *testing.T) {
	auth, audit := adminFixture(t)
	api := &API{}
	h := api.routes(auth, audit)
	defer api.terminals.Close()
	path := "/api/v1/terminal/passwords/host"
	for _, password := range []string{"", "line\ncommand", "line\rcommand", "\x1b[31m", strings.Repeat("x", 1025)} {
		body, _ := json.Marshal(map[string]string{"password": password})
		if w := adminRequest(h, "POST", path, "admin", string(body)); w.Code != 400 {
			t.Fatal("unsafe password accepted", w.Code)
		}
	}
	for _, body := range []string{`{}`, `{"password":"x","extra":true}`, `{"password":"x"}{}`} {
		if w := adminRequest(h, "POST", path, "admin", body); w.Code != 400 {
			t.Fatal(w.Code)
		}
	}
	if _, e := os.Stat(filepath.Join(auth.dir, terminalPasswordKeyFile)); !os.IsNotExist(e) {
		t.Fatal("invalid request created key")
	}
	if _, _, e := auth.passwordOperation("admin", "host", "save", pasteTestPassword); e != nil {
		t.Fatal(e)
	}
	keyPath := filepath.Join(auth.dir, terminalPasswordKeyFile)
	key, _ := os.ReadFile(keyPath)
	os.Chmod(keyPath, 0644)
	if _, _, e := auth.passwordOperation("admin", "host", "reveal", ""); e == nil {
		t.Fatal("unsafe key permissions accepted")
	}
	os.Chmod(keyPath, 0600)
	os.Remove(keyPath)
	if _, _, e := auth.passwordOperation("admin", "host", "save", "replacement"); e == nil {
		t.Fatal("missing key silently regenerated")
	}
	if _, e := os.Stat(keyPath); !os.IsNotExist(e) {
		t.Fatal("missing key recreated")
	}
	os.WriteFile(keyPath, key, 0600)
	var data terminalPasswordData
	encoded, _ := os.ReadFile(filepath.Join(auth.dir, terminalPasswordFile))
	json.Unmarshal(encoded, &data)
	for id, value := range data.Records {
		decoded, _ := base64.StdEncoding.DecodeString(value)
		decoded[len(decoded)-1] ^= 1
		data.Records[id] = base64.StdEncoding.EncodeToString(decoded)
	}
	encoded, _ = json.Marshal(data)
	os.WriteFile(filepath.Join(auth.dir, terminalPasswordFile), encoded, 0600)
	if _, _, e := auth.passwordOperation("admin", "host", "reveal", ""); e == nil {
		t.Fatal("tampered ciphertext accepted")
	}
}
func TestTerminalPasswordConcurrentStoresAndRecreatedIdentity(t *testing.T) {
	auth, _ := adminFixture(t)
	other, e := NewAuthStore(auth.dir, time.Hour)
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	for i, store := range []*AuthStore{auth, other} {
		wg.Add(1)
		go func(i int, s *AuthStore) {
			defer wg.Done()
			target := "host"
			if i == 1 {
				target = "container-" + strings.Repeat("a", 64)
			}
			if _, _, e := s.passwordOperation("admin", target, "save", pasteTestPassword); e != nil {
				t.Error(e)
			}
		}(i, store)
	}
	wg.Wait()
	for _, target := range []string{"host", "container-" + strings.Repeat("a", 64)} {
		if saved, plain, e := auth.passwordOperation("admin", target, "reveal", ""); e != nil || !saved || plain != pasteTestPassword {
			t.Fatal("concurrent credential overwritten", e)
		}
	}
	if e := auth.RemoveUser("admin"); e != nil {
		t.Fatal(e)
	}
	if e := auth.AddUser("admin", RoleAdmin, testPassword); e != nil {
		t.Fatal(e)
	}
	token, _, _, e := auth.Login("admin", testPassword, "test-only")
	if e != nil {
		t.Fatal(e)
	}
	if saved, _, e := auth.passwordOperation(token, "host", "status", ""); e != nil || saved {
		t.Fatal("recreated account inherited password", e)
	}
}
func TestFilesCannotPreviewDownloadDeleteOrPrecreatePasswordMaterial(t *testing.T) {
	f := newFileFixture(t)
	if _, _, e := f.auth.passwordOperation(f.token, "host", "save", pasteTestPassword); e != nil {
		t.Fatal(e)
	}
	for _, name := range []string{terminalPasswordFile, terminalPasswordKeyFile} {
		alias := strings.TrimPrefix(name, ".") + "-alias"
		os.Link(filepath.Join(f.auth.dir, name), filepath.Join(f.root, alias))
		info, _ := os.Stat(filepath.Join(f.root, alias))
		query := url.Values{"path": {"/" + alias}, "version": {fileVersion(info)}}.Encode()
		for _, methodPath := range [][2]string{{"GET", "/api/v1/files/preview?" + query}, {"POST", "/api/v1/files/download-ticket"}, {"DELETE", "/api/v1/files"}} {
			body := ""
			if methodPath[0] == "POST" {
				body = `{"path":"/` + alias + `"}`
			} else if methodPath[0] == "DELETE" {
				body = `{"path":"/` + alias + `","version":"` + fileVersion(info) + `"}`
			}
			w := f.request(methodPath[0], methodPath[1], strings.NewReader(body), f.token)
			if w.Code != 403 {
				t.Fatal(name, methodPath, w.Code, w.Body.String())
			}
		}
	}
	// A separate explorer rooted in the private directory must reject upload of a
	// reserved key name even before it exists. Ordinary files elsewhere are unaffected.
	private, e := newFileExplorer(f.auth.dir, 1024, time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	defer private.close()
	private.privateDir = f.auth.dir
	r := httptest.NewRequest("POST", "/api/v1/files/upload?path=/&name="+terminalPasswordKeyFile, strings.NewReader("chosen key"))
	w := httptest.NewRecorder()
	private.upload(w, r)
	if w.Code != 403 {
		t.Fatal("key precreation allowed", w.Code)
	}
}
