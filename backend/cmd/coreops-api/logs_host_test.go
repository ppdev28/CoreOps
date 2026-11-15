package main

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/moby/moby/client"
)

func decodeLogPage(t *testing.T, api *API, target string) (LogsOverview, *httptest.ResponseRecorder) {
	t.Helper()
	w := httptest.NewRecorder()
	api.logs(w, httptest.NewRequest("GET", target, nil))
	var result LogsOverview
	if w.Code == 200 {
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
	}
	return result, w
}
func fakeJournal(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > '" + filepath.Join(dir, "args") + "'\n" + body
	if err := os.WriteFile(filepath.Join(dir, "journalctl"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	return dir
}
func TestJournalHistoryCursorFiltersAndValidation(t *testing.T) {
	rows := ""
	for n := 4; n >= 0; n-- {
		rows += fmt.Sprintf("printf '%%s\\n' '{\"__CURSOR\":\"s=test;i=%d\",\"__REALTIME_TIMESTAMP\":\"%d\",\"_SYSTEMD_UNIT\":\"ssh.service\",\"PRIORITY\":\"6\",\"MESSAGE\":\"event %d\"}'\n", n, 1735689600000000+n, n)
	}
	dir := fakeJournal(t, rows)
	api := &API{}
	page, w := decodeLogPage(t, api, "/api/v1/logs?source=system&category=kernel&unit=ssh.service&limit=2&since=2025-01-01T00:00:00Z")
	if w.Code != 200 || len(page.Entries) != 2 || page.Entries[0].Message != "event 3" || page.NextCursor != "s=test;i=3" {
		t.Fatalf("%d %+v %s", w.Code, page, w.Body.String())
	}
	args, _ := os.ReadFile(filepath.Join(dir, "args"))
	for _, arg := range []string{"--reverse", "_TRANSPORT=kernel", "--unit=ssh.service", "--since=2025-01-01T00:00:00Z"} {
		if !strings.Contains(string(args), arg) {
			t.Errorf("missing argument %s: %s", arg, args)
		}
	}
	// Simulate the inclusive --cursor anchor from journalctl.
	// A separate fixture begins at the cursor and then goes backwards.
	fakeJournal(t, strings.Join(strings.Split(rows, "\n")[1:], "\n"))
	page, w = decodeLogPage(t, api, "/api/v1/logs?source=system&limit=2&cursor="+url.QueryEscape(page.NextCursor))
	if w.Code != 200 || len(page.Entries) != 2 || page.Entries[0].Message != "event 1" || page.Entries[1].Message != "event 2" || page.NextCursor != "s=test;i=1" {
		t.Fatalf("inclusive anchor repeated: %+v %s", page, w.Body.String())
	}
	for _, query := range []string{"limit=0", "limit=1001", "limit=NaN", "cursor=x%0Ay", "category=shell", "unit=--system", "since=yesterday", "since=2026-01-01T00:00:00Z&until=2025-01-01T00:00:00Z"} {
		_, w = decodeLogPage(t, api, "/api/v1/logs?source=system&"+query)
		if w.Code != 400 {
			t.Errorf("accepted %s: %d", query, w.Code)
		}
	}
}
func TestJournalPartialAccessAndBinaryMessages(t *testing.T) {
	fakeJournal(t, "printf '%s\\n' 'Hint: You are currently not seeing messages from other users.' >&2\nprintf '%s\\n' '{\"MESSAGE\":[104,105],\"PRIORITY\":\"3\"}'\n")
	page, w := decodeLogPage(t, &API{}, "/api/v1/logs?source=system")
	if w.Code != 200 || len(page.Warnings) != 1 || len(page.Entries) != 1 || page.Entries[0].Message != "hi" || page.Entries[0].Timestamp != "" {
		t.Fatalf("partial access hidden or data invented: %+v", page)
	}
	fakeJournal(t, "exit 1\n")
	_, w = decodeLogPage(t, &API{}, "/api/v1/logs?source=system")
	if w.Code != 502 {
		t.Fatal(w.Code)
	}
}
func TestHostTextLogPagesAndRotation(t *testing.T) {
	dir := t.TempDir()
	name := filepath.Join(dir, "syslog")
	var text strings.Builder
	for n := 0; n < 1200; n++ {
		fmt.Fprintf(&text, "2025-01-01T00:00:00Z line %d\n", n)
	}
	if err := os.WriteFile(name, []byte(text.String()), 0600); err != nil {
		t.Fatal(err)
	}
	api := &API{logRoot: dir}
	cursor := ""
	count := 0
	for pageNumber := 0; pageNumber < 3; pageNumber++ {
		page, w := decodeLogPage(t, api, "/api/v1/logs?source=file&file=syslog&limit=500&cursor="+url.QueryEscape(cursor))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		want := 500
		if pageNumber == 2 {
			want = 200
		}
		if len(page.Entries) != want {
			t.Fatal(len(page.Entries), want)
		}
		expected := fmt.Sprintf("line %d", max(0, 1200-(pageNumber+1)*500))
		if page.Entries[0].Message != expected {
			t.Fatal(page.Entries[0])
		}
		count += len(page.Entries)
		cursor = page.NextCursor
	}
	if cursor != "" || count != 1200 {
		t.Fatal("history incomplete", count, cursor)
	}
	first, _ := decodeLogPage(t, api, "/api/v1/logs?source=file&file=syslog&limit=5")
	if err := os.Rename(name, name+".1"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte("rotated\n"), 0600); err != nil {
		t.Fatal(err)
	}
	_, w := decodeLogPage(t, api, "/api/v1/logs?source=file&file=syslog&cursor="+url.QueryEscape(first.NextCursor))
	if w.Code != 409 {
		t.Fatalf("rotation unnoticed: %d", w.Code)
	}
}
func TestHostLogConfinementAndCatalog(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	_ = os.WriteFile(filepath.Join(outside, "auth.log"), []byte("private"), 0600)
	_ = os.WriteFile(filepath.Join(dir, "syslog"), []byte("normal\n"), 0600)
	_ = os.WriteFile(filepath.Join(dir, "binary.log"), []byte{0, 1, 2}, 0600)
	_ = os.Symlink(filepath.Join(outside, "auth.log"), filepath.Join(dir, "escape.log"))
	_ = os.Symlink(outside, filepath.Join(dir, "outside"))
	if err := syscall.Mkfifo(filepath.Join(dir, "pipe.log"), 0600); err != nil {
		t.Fatal(err)
	}
	api := &API{logRoot: dir}
	for _, name := range []string{"../auth.log", "/etc/passwd", "outside/auth.log", "escape.log", "pipe.log", "binary.log", "journal/x.log"} {
		_, w := decodeLogPage(t, api, "/api/v1/logs?source=file&file="+url.QueryEscape(name))
		if w.Code == 200 {
			t.Errorf("unsafe path read: %s", name)
		}
	}
	w := httptest.NewRecorder()
	api.logSources(w, httptest.NewRequest("GET", "/api/v1/logs/sources", nil))
	var catalog hostLogCatalog
	if err := json.Unmarshal(w.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	for _, file := range catalog.Files {
		if file.Path == "escape.log" || file.Path == "pipe.log" || strings.HasPrefix(file.Path, "outside/") {
			t.Fatal("unsafe file discovered", file)
		}
	}
	if len(catalog.Files) != 2 {
		t.Fatalf("catalog: %+v", catalog)
	}
}
func TestHostGzipHistoryAndCancellation(t *testing.T) {
	dir := t.TempDir()
	f, err := os.Create(filepath.Join(dir, "syslog.1.gz"))
	if err != nil {
		t.Fatal(err)
	}
	archive := gzip.NewWriter(f)
	for n := 0; n < 7; n++ {
		fmt.Fprintf(archive, "archived %d\n", n)
	}
	archive.Close()
	f.Close()
	api := &API{logRoot: dir}
	cursor := ""
	total := 0
	for pageNumber := 0; pageNumber < 3; pageNumber++ {
		page, w := decodeLogPage(t, api, "/api/v1/logs?source=file&file=syslog.1.gz&limit=3&cursor="+url.QueryEscape(cursor))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		if page.HistoryOrder != "newer" || page.Entries[0].Message != fmt.Sprintf("archived %d", total) {
			t.Fatal(page)
		}
		total += len(page.Entries)
		cursor = page.NextCursor
	}
	if total != 7 || cursor != "" {
		t.Fatal(total, cursor)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest("GET", "/api/v1/logs?source=file&file=syslog.1.gz", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	api.logs(w, request)
	if w.Code != 502 && w.Code != 503 {
		t.Fatal("canceled read accepted", w.Code)
	}
}
func TestDockerEventSnapshotTerminatesAndPreservesMetadata(t *testing.T) {
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || !strings.HasSuffix(r.URL.Path, "/events") || r.URL.Query().Get("since") == "" || r.URL.Query().Get("until") == "" {
			t.Errorf("bad request: %s %s", r.Method, r.URL.String())
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintln(w, `{"Type":"container","Action":"oom","Actor":{"ID":"abc","Attributes":{"name":"worker","exitCode":"137","secret":"must not leak"}},"timeNano":1735689600123456789}`)
	}))
	defer engine.Close()
	docker, err := client.NewClientWithOpts(client.WithHost("tcp://"+engine.Listener.Addr().String()), client.WithVersion("1.52"))
	if err != nil {
		t.Fatal(err)
	}
	defer docker.Close()
	start := time.Now()
	page, w := decodeLogPage(t, &API{docker: docker}, "/api/v1/logs?source=events")
	if time.Since(start) > time.Second || w.Code != 200 || len(page.Entries) != 1 {
		t.Fatalf("events did not end: %d %s", w.Code, w.Body.String())
	}
	if page.Entries[0].Timestamp != "2025-01-01T00:00:00.123456789Z" || page.Entries[0].Level != "ERROR" || strings.Contains(w.Body.String(), "must not leak") {
		t.Fatal(page)
	}
}

func TestHostLogSourceRolesAndRevocation(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "syslog"), []byte("real log\n"), 0600); err != nil {
		t.Fatal(err)
	}
	fakeJournal(t, "printf '%s\\n' '{\"MESSAGE\":\"journal event\"}'\n")
	store := newTestStore(t)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleAdmin} {
		store.users[string(role)] = User{Name: string(role), Role: role}
		store.sessions[tokenKey(string(role))] = session{User: string(role), Expires: time.Now().Add(time.Hour)}
	}
	if err := store.save(usersFileName, store.users); err != nil {
		t.Fatal(err)
	}
	if err := store.save(sessionsFileName, store.sessions); err != nil {
		t.Fatal(err)
	}
	api := &API{logRoot: dir}
	handler := api.routes(store, NewAuditLog(store.dir))
	defer api.terminals.Close()
	request := func(token, target string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", target, nil)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	paths := []string{"/api/v1/logs/sources", "/api/v1/logs?source=file&file=syslog", "/api/v1/logs?source=system&category=kernel", "/api/v1/logs?source=events"}
	for _, target := range paths {
		for token, want := range map[string]int{"": 401, "viewer": 403} {
			if w := request(token, target); w.Code != want {
				t.Fatalf("%s %s: %d", token, target, w.Code)
			}
		}
	}
	for _, token := range []string{"operator", "admin"} {
		for _, target := range paths[:3] {
			w := request(token, target)
			if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("%s %s: %d %s", token, target, w.Code, w.Body.String())
			}
		}
	}
	cli, err := NewAuthStore(store.dir, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if err = cli.RemoveUser("operator"); err != nil {
		t.Fatal(err)
	}
	for _, target := range paths {
		if w := request("operator", target); w.Code != 401 {
			t.Fatal("revoked session can read", target, w.Code)
		}
	}
}
func TestHostLogPagingAcrossByteWindows(t *testing.T) {
	dir := t.TempDir()
	var data strings.Builder
	for n := 0; n < 10000; n++ {
		fmt.Fprintf(&data, "line-%05d %s\n", n, strings.Repeat("x", 250))
	}
	if err := os.WriteFile(filepath.Join(dir, "large.log"), []byte(data.String()), 0600); err != nil {
		t.Fatal(err)
	}
	api := &API{logRoot: dir}
	cursor := ""
	total := 0
	for n := 0; n < 10; n++ {
		page, w := decodeLogPage(t, api, "/api/v1/logs?source=file&file=large.log&limit=1000&cursor="+url.QueryEscape(cursor))
		if w.Code != 200 || len(page.Entries) != 1000 {
			t.Fatalf("page %d: %d %s", n, w.Code, w.Body.String())
		}
		if !strings.HasPrefix(page.Entries[0].Message, fmt.Sprintf("line-%05d", 9000-n*1000)) {
			t.Fatal("missing or repeated line", n, page.Entries[0].Message)
		}
		total += len(page.Entries)
		cursor = page.NextCursor
	}
	if total != 10000 || cursor != "" {
		t.Fatal(total, cursor)
	}
}

func TestJournalServiceScanCarriesCursorAcrossNonServicePages(t *testing.T) {
	var body strings.Builder
	for n := 1001; n >= 1; n-- {
		fmt.Fprintf(&body, "printf '%%s\\n' '{\"__CURSOR\":\"i=%d\",\"_TRANSPORT\":\"kernel\",\"MESSAGE\":\"kernel record\"}'\n", n)
	}
	fakeJournal(t, body.String())
	page, w := decodeLogPage(t, &API{}, "/api/v1/logs?source=system&category=services&limit=2")
	if w.Code != 200 || len(page.Entries) != 0 || page.NextCursor != "i=2" {
		t.Fatalf("service scan lost history: %d %+v", w.Code, page)
	}
}

func TestHostFilesDoNotBypassCoreOpsAuditRole(t *testing.T) {
	dir := t.TempDir()
	audit := NewAuditLog(dir)
	audit.Append(AuditEntry{Time: time.Now(), User: "private-admin", Method: "POST", Path: "/private-action", Status: 200})
	if err := os.Link(filepath.Join(dir, auditFileName), filepath.Join(dir, "alias.log")); err != nil {
		t.Fatal(err)
	}
	store := newTestStore(t)
	for _, role := range []Role{RoleOperator, RoleAdmin} {
		store.users[string(role)] = User{Name: string(role), Role: role}
		store.sessions[tokenKey(string(role))] = session{User: string(role), Expires: time.Now().Add(time.Hour)}
	}
	if err := store.save(usersFileName, store.users); err != nil {
		t.Fatal(err)
	}
	if err := store.save(sessionsFileName, store.sessions); err != nil {
		t.Fatal(err)
	}
	api := &API{logRoot: dir}
	handler := api.routes(store, audit)
	defer api.terminals.Close()
	request := func(role, target string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", target, nil)
		r.Header.Set("Authorization", "Bearer "+role)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, role := range []string{"operator", "admin"} {
		for _, name := range []string{auditFileName, "alias.log"} {
			w := request(role, "/api/v1/logs?source=file&file="+name)
			if w.Code != 403 || strings.Contains(w.Body.String(), "private-admin") {
				t.Fatal("audit leaked via host logs", w.Code, w.Body.String())
			}
		}
	}
	if w := request("operator", "/api/v1/audit"); w.Code != 403 {
		t.Fatal(w.Code)
	}
	if w := request("admin", "/api/v1/audit"); w.Code != 200 || !strings.Contains(w.Body.String(), "private-admin") {
		t.Fatal("admin audit broken", w.Code)
	}
	w := request("operator", "/api/v1/logs/sources")
	var catalog hostLogCatalog
	if err := json.Unmarshal(w.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Files) != 0 {
		t.Fatal("private audit discovered", catalog)
	}
}

func TestJournalServiceEventsIncludeManagerLifecycle(t *testing.T) {
	fakeJournal(t, "printf '%s\\n' '{\"__CURSOR\":\"i=1\",\"_SYSTEMD_UNIT\":\"init.scope\",\"SYSLOG_IDENTIFIER\":\"systemd\",\"MESSAGE\":\"Started worker.service\"}'\n")
	page, w := decodeLogPage(t, &API{}, "/api/v1/logs?source=system&category=services")
	if w.Code != 200 || len(page.Entries) != 1 || !strings.Contains(page.Entries[0].Message, "Started worker.service") {
		t.Fatalf("manager events missing: %d %+v", w.Code, page)
	}
}
