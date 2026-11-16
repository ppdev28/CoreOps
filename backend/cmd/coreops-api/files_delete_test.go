package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestFileDeleteVersionRootSymlinksRolesAndAudit(t *testing.T) {
	f := newFileFixture(t)
	if e := os.WriteFile(filepath.Join(f.root, "remove.txt"), []byte("disposable"), 0600); e != nil {
		t.Fatal(e)
	}
	listing := f.request("GET", "/api/v1/files", nil, f.token)
	var data fileListing
	json.Unmarshal(listing.Body.Bytes(), &data)
	version := data.Entries[0].Version
	if version == "" {
		t.Fatal("no file version")
	}
	payload := func(path, version string) *bytes.Reader {
		b, _ := json.Marshal(map[string]string{"path": path, "version": version})
		return bytes.NewReader(b)
	}
	if w := f.request("DELETE", "/api/v1/files", payload("/remove.txt", version), ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
	f.auth.users["viewer"] = User{Name: "viewer", Role: RoleViewer}
	f.auth.save(usersFileName, f.auth.users)
	// Existing fixtures already verify role routes; use the persisted store login.
	if w := f.request("DELETE", "/api/v1/files", payload("/../remove.txt", version), f.token); w.Code != 400 {
		t.Fatal(w.Code)
	}
	os.Mkdir(filepath.Join(f.root, "dir"), 0700)
	os.Symlink("remove.txt", filepath.Join(f.root, "link"))
	for _, path := range []string{"/", "/dir", "/link"} {
		if w := f.request("DELETE", "/api/v1/files", payload(path, version), f.token); w.Code != 400 {
			t.Fatal(path, w.Code)
		}
	}
	os.WriteFile(filepath.Join(f.root, "remove.txt"), []byte("changed"), 0600)
	if w := f.request("DELETE", "/api/v1/files", payload("/remove.txt", version), f.token); w.Code != 409 {
		t.Fatal(w.Code)
	}
	info, _ := os.Stat(filepath.Join(f.root, "remove.txt"))
	version = fileVersion(info)
	if w := f.request("DELETE", "/api/v1/files", payload("/remove.txt", version), f.token); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	entries, e := f.audit.Tail(100)
	if e != nil {
		t.Fatal(e)
	}
	audited := false
	for _, entry := range entries {
		if entry.Method == "DELETE" && entry.Status == 200 && entry.User == "admin" && entry.Detail == "delete file /remove.txt" {
			audited = true
		}
	}
	if !audited {
		t.Fatal("missing successful deletion audit entry")
	}
	if _, e := os.Stat(filepath.Join(f.root, "remove.txt")); !os.IsNotExist(e) {
		t.Fatal("file survived")
	}
	if w := f.request("DELETE", "/api/v1/files", payload("/remove.txt", version), f.token); w.Code != 404 {
		t.Fatal(w.Code)
	}
	outside := filepath.Join(t.TempDir(), "untouched")
	os.WriteFile(outside, []byte("safe"), 0600)
	os.Symlink(filepath.Dir(outside), filepath.Join(f.root, "escape"))
	if w := f.request("DELETE", "/api/v1/files", payload("/escape/untouched", version), f.token); w.Code == 200 {
		t.Fatal("symlink root escape")
	}
	if _, e := os.Stat(outside); e != nil {
		t.Fatal("outside file removed")
	}
	// Protect live CoreOps identity even through a hard link under the explorer.
	if e := os.Link(filepath.Join(f.auth.dir, usersFileName), filepath.Join(f.root, "users-alias")); e != nil {
		t.Fatal(e)
	}
	info, _ = os.Stat(filepath.Join(f.root, "users-alias"))
	if w := f.request("DELETE", "/api/v1/files", payload("/users-alias", fileVersion(info)), f.token); w.Code != 403 {
		t.Fatal(w.Code, w.Body.String())
	}
	if os.Geteuid() != 0 {
		locked := filepath.Join(f.root, "permission.txt")
		os.WriteFile(locked, []byte("keep"), 0600)
		info, _ := os.Stat(locked)
		if e := os.Chmod(f.root, 0500); e != nil {
			t.Fatal(e)
		}
		response := f.request("DELETE", "/api/v1/files", payload("/permission.txt", fileVersion(info)), f.token)
		os.Chmod(f.root, 0700)
		if response.Code != 403 {
			t.Fatalf("expected filesystem permission rejection: %d %s", response.Code, response.Body.String())
		}
		if _, e := os.Stat(locked); e != nil {
			t.Fatal("permission failure removed file")
		}
	}

}
