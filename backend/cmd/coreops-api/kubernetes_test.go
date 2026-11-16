package main

import (
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const kubeTestUID = "deployment-uid"

func kubeTestObject(kind, name, ns string) kubeObject {
	raw := fmt.Sprintf(`{"apiVersion":"apps/v1","kind":%q,"metadata":{"name":%q,"namespace":%q,"uid":"%s","resourceVersion":"10","generation":2,"creationTimestamp":"2026-11-14T10:00:00Z"},"spec":{"replicas":2,"selector":{"matchLabels":{"app":"api"}},"strategy":{"type":"RollingUpdate"},"template":{"spec":{"containers":[{"name":"api","image":"example/api:v1"}]}}},"status":{"observedGeneration":2,"replicas":2,"updatedReplicas":2,"availableReplicas":1}}`, kind, name, ns, kubeTestUID)
	var o kubeObject
	if err := json.Unmarshal([]byte(raw), &o); err != nil {
		panic(err)
	}
	return o
}

type kubeHarness struct {
	handler  http.Handler
	manager  *kubeManager
	profile  kubeProfile
	mu       sync.Mutex
	calls    []string
	patch    map[string]any
	allowed  bool
	denyPods bool
	resource kubeObject
	audit    *AuditLog
}

func newKubeHarness(t *testing.T) *kubeHarness {
	t.Helper()
	h := &kubeHarness{allowed: true, resource: kubeTestObject("Deployment", "api", "apps")}
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.calls = append(h.calls, r.Method+" "+r.URL.RequestURI())
		if r.Header.Get("Authorization") != "Bearer private-kubernetes-token" {
			t.Error("missing upstream credential")
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/version":
			_, _ = w.Write([]byte(`{"gitVersion":"v1.34.1"}`))
		case strings.Contains(r.URL.Path, "selfsubjectaccessreviews"):
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if ko(ko(body["spec"])["resourceAttributes"])["namespace"] != "apps" {
				t.Error("permission check missing namespace")
			}
			writeJSON(w, 201, map[string]any{"status": map[string]bool{"allowed": h.allowed}})
		case strings.HasPrefix(r.URL.Path, "/apis/metrics.k8s.io/"):
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"message":"not installed"}`))
		case r.Method == "PATCH":
			_ = json.NewDecoder(r.Body).Decode(&h.patch)
			writeJSON(w, 200, h.resource)
		case strings.HasSuffix(r.URL.Path, "/pods") && h.denyPods:
			w.WriteHeader(403)
			_, _ = w.Write([]byte(`{"message":"secret-upstream-message"}`))
		case strings.HasSuffix(r.URL.Path, "/log"):
			if r.URL.Query().Get("tailLines") != "1000" || r.URL.Query().Get("limitBytes") != "262144" || r.URL.Query().Get("follow") != "" {
				t.Error("unbounded logs")
			}
			_, _ = w.Write([]byte("2026-11-15T10:00:00Z real log line\n"))
		case strings.HasSuffix(r.URL.Path, "/api") || strings.HasSuffix(r.URL.Path, "/pod"):
			writeJSON(w, 200, h.resource)
		default:
			writeJSON(w, 200, map[string]any{"items": []any{}, "metadata": map[string]any{}})
		}
	}))
	t.Cleanup(upstream.Close)
	cert, err := x509.ParseCertificate(upstream.TLS.Certificates[0].Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	h.profile = kubeProfile{ID: "0123456789abcdef0123", Name: "Integration cluster", Server: upstream.URL, Namespaces: []string{"apps"}, CA: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw})), Token: "private-kubernetes-token"}
	h.manager = newKubeManager(t.TempDir())
	if err = h.manager.save(h.profile); err != nil {
		t.Fatal(err)
	}
	store := newTestStore(t)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleAdmin} {
		store.users[string(role)] = User{Name: string(role), Role: role}
		store.sessions[tokenKey(string(role))] = session{User: string(role), Expires: time.Now().Add(time.Hour)}
	}
	if err = store.save(usersFileName, store.users); err != nil {
		t.Fatal(err)
	}
	if err = store.save(sessionsFileName, store.sessions); err != nil {
		t.Fatal(err)
	}
	api := &API{kube: h.manager}
	h.audit = NewAuditLog(store.dir)
	h.handler = withAudit(h.audit, api.routes(store, h.audit))
	t.Cleanup(api.terminals.Close)
	return h
}
func (h *kubeHarness) request(method, path, role, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/api/v1/kubernetes"+path, strings.NewReader(body))
	if role != "" {
		r.Header.Set("Authorization", "Bearer "+role)
	}
	w := httptest.NewRecorder()
	h.handler.ServeHTTP(w, r)
	return w
}
func (h *kubeHarness) path(s string) string { return "/" + h.profile.ID + s }
func TestKubeConnectionAndCredentials(t *testing.T) {
	h := newKubeHarness(t)
	for _, role := range []string{"", "viewer", "operator"} {
		expected := 403
		if role == "" {
			expected = 401
		}
		if w := h.request("POST", "/clusters", role, `{}`); w.Code != expected {
			t.Fatalf("role %s: %d", role, w.Code)
		}
	}
	w := h.request("GET", "/clusters", "viewer", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), h.profile.Token) || strings.Contains(w.Body.String(), "CERTIFICATE") {
		t.Fatalf("unsafe listing: %d %s", w.Code, w.Body.String())
	}
	p := h.profile
	p.ID = ""
	p.Name = "Second connection"
	b, _ := json.Marshal(p)
	w = h.request("POST", "/clusters", "admin", string(b))
	if w.Code != 201 {
		t.Fatalf("connect: %d %s", w.Code, w.Body.String())
	}
	var saved kubeCluster
	_ = json.Unmarshal(w.Body.Bytes(), &saved)
	stored, err := newKubeManager(h.manager.dir).load(saved.ID)
	if err != nil || stored.Token != p.Token {
		t.Fatal("connection not persisted")
	}
	info, _ := os.Stat(filepath.Join(h.manager.dir, saved.ID+".json"))
	if info.Mode().Perm() != 0600 {
		t.Fatal("credentials not private")
	}
	if w = h.request("POST", "/clusters", "admin", string(b)); w.Code != 409 {
		t.Fatalf("duplicate: %d", w.Code)
	}
	for _, body := range []string{`{"name":"x","server":"http://localhost","namespaces":["apps"],"token":"secret"}`, `{"name":"x","server":"https://host/path","namespaces":["apps"],"token":"secret"}`, `{"name":"x","server":"https://host","namespaces":["apps"],"token":"secret","exec":{"command":"sh"}}`, `{"name":"x","server":"https://host","namespaces":["../outside"],"token":"secret"}`} {
		if w = h.request("POST", "/clusters", "admin", body); w.Code != 400 {
			t.Fatalf("invalid config: %d %s", w.Code, w.Body.String())
		}
	}
	rows, _ := h.audit.Tail(100)
	for _, r := range rows {
		if strings.Contains(r.Detail, p.Token) || strings.Contains(r.Detail, "CERTIFICATE") {
			t.Fatal("credential in audit")
		}
	}
}
func TestKubeTLSAndRedirectProtection(t *testing.T) {
	h := newKubeHarness(t)
	p := h.profile
	p.CA = ""
	c, e := newKubeClient(p)
	if e != nil {
		t.Fatal(e)
	}
	defer c.close()
	if e = c.get(t.Context(), "/version", &map[string]any{}); e == nil {
		t.Fatal("untrusted certificate accepted")
	}
	for _, server := range []string{"http://example.org", "https://user:pass@example.org", "https://example.org?token=x", "https://example.org/path"} {
		p.Server = server
		if _, e = kubeHTTPClient(p); e == nil {
			t.Fatalf("accepted unsafe origin %s", server)
		}
	}
}
func TestKubeNamespaceScopeAndUnavailableCollections(t *testing.T) {
	h := newKubeHarness(t)
	w := h.request("GET", h.path("/snapshot?namespace=other"), "viewer", "")
	if w.Code != 403 {
		t.Fatalf("scope: %d", w.Code)
	}
	if len(h.calls) != 0 {
		t.Fatal("out of scope reached cluster")
	}
	h.denyPods = true
	w = h.request("GET", h.path("/snapshot?namespace=apps"), "viewer", "")
	if w.Code != 200 {
		t.Fatalf("snapshot: %d %s", w.Code, w.Body.String())
	}
	var snap kubeSnapshot
	_ = json.Unmarshal(w.Body.Bytes(), &snap)
	if snap.Metrics != nil || snap.Errors["metrics"] == "" || snap.Errors["pods"] == "" || snap.Resources["pods"] != nil {
		t.Fatal("unavailable collection represented as measured zero")
	}
	if strings.Contains(w.Body.String(), "secret-upstream-message") {
		t.Fatal("upstream error leaked")
	}
	for _, p := range h.calls {
		if strings.Contains(p, "/pods") && !strings.Contains(p, "/namespaces/apps/") {
			t.Fatalf("escaped namespace: %s", p)
		}
	}
}
func TestKubeDeploymentActionsAndAudit(t *testing.T) {
	h := newKubeHarness(t)
	path := h.path("/deployments/apps/api/scale")
	body := `{"uid":"deployment-uid","version":"10","replicas":3}`
	if w := h.request("POST", path, "viewer", body); w.Code != 403 {
		t.Fatalf("viewer mutation: %d", w.Code)
	}
	if len(h.calls) != 0 {
		t.Fatal("unauthorized mutation reached cluster")
	}
	for _, bad := range []string{`{"uid":"old-uid","version":"10","replicas":3}`, `{"uid":"deployment-uid","version":"9","replicas":3}`} {
		if w := h.request("POST", path, "operator", bad); w.Code != 409 {
			t.Fatalf("stale action: %d", w.Code)
		}
	}
	for _, bad := range []string{`{"uid":"deployment-uid","version":"10","replicas":-1}`, `{"uid":"deployment-uid","version":"10","replicas":1001}`, body + `{}`} {
		if w := h.request("POST", path, "operator", bad); w.Code != 400 {
			t.Fatalf("invalid action: %d", w.Code)
		}
	}
	h.allowed = false
	if w := h.request("POST", path, "operator", body); w.Code != 403 {
		t.Fatalf("RBAC: %d", w.Code)
	}
	if h.patch != nil {
		t.Fatal("RBAC denied action patched")
	}
	h.allowed = true
	w := h.request("POST", path, "operator", body)
	if w.Code != 202 {
		t.Fatalf("scale: %d %s", w.Code, w.Body.String())
	}
	if ko(h.patch["spec"])["replicas"] != float64(3) || ko(h.patch["metadata"])["resourceVersion"] != "10" {
		t.Fatalf("unsafe patch: %v", h.patch)
	}
	if !strings.HasSuffix(h.calls[len(h.calls)-1], "/scale") {
		t.Fatal("wrong scale subresource")
	}
	w = h.request("POST", h.path("/deployments/apps/api/restart"), "operator", `{"uid":"deployment-uid","version":"10"}`)
	if w.Code != 202 {
		t.Fatalf("restart: %d %s", w.Code, w.Body.String())
	}
	if ko(ko(ko(ko(h.patch["spec"])["template"])["metadata"])["annotations"])["kubectl.kubernetes.io/restartedAt"] == nil {
		t.Fatal("restart missing annotation")
	}
	rows, _ := h.audit.Tail(100)
	if rows[0].Status != 202 || !strings.Contains(rows[0].Detail, "namespace=apps") {
		t.Fatal("missing scoped audit outcome")
	}
	ko(ko(h.resource["spec"])["strategy"])["type"] = "Recreate"
	w = h.request("POST", h.path("/deployments/apps/api/restart"), "operator", `{"uid":"deployment-uid","version":"10"}`)
	if w.Code != 409 {
		t.Fatal("Recreate treated as rolling restart")
	}
}
func TestKubePodReadinessAndDiagnosis(t *testing.T) {
	var o kubeObject
	_ = json.Unmarshal([]byte(`{"metadata":{"name":"api","namespace":"apps"},"spec":{"containers":[{"name":"api","image":"api:v1","resources":{"requests":{"cpu":"100m"}}}]},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"False"}],"containerStatuses":[{"name":"api","ready":false,"restartCount":4,"state":{"waiting":{"reason":"CrashLoopBackOff","message":"Back-off restarting failed container"}}}]}}`), &o)
	r := kubeMap("pods", o)
	if r.Ready || !r.Problem || r.Phase != "Running" || r.Available != 0 || r.Desired != 1 || r.Restarts != 4 || r.Reason != "CrashLoopBackOff" || r.Containers[0].Requests["cpu"] != "100m" {
		t.Fatalf("wrong diagnostics: %+v", r)
	}
	selector := kubeObject{"matchExpressions": []any{map[string]any{"key": "tier", "operator": "NotIn", "values": []any{"worker"}}}}
	if !kubeMatches(selector, kubeObject{"tier": "api"}) || kubeMatches(selector, kubeObject{"tier": "worker"}) || kubeMatches(nil, kubeObject{}) || kubeMatches(kubeObject{"matchLabels": map[string]any{}}, kubeObject{}) {
		t.Fatal("incorrect label selector")
	}
}
func TestKubeSensitiveReadsAndBoundedLogs(t *testing.T) {
	h := newKubeHarness(t)
	path := h.path("/resources/deployments/apps/api/yaml")
	if w := h.request("GET", path, "viewer", ""); w.Code != 403 {
		t.Fatal("viewer manifest access")
	}
	w := h.request("GET", path, "operator", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "apiVersion") {
		t.Fatalf("YAML: %d %s", w.Code, w.Body.String())
	}
	var pod kubeObject
	_ = json.Unmarshal([]byte(`{"metadata":{"name":"pod","namespace":"apps"},"spec":{"containers":[{"name":"web","image":"nginx"}]},"status":{"phase":"Running"}}`), &pod)
	h.resource = pod
	path = h.path("/resources/pods/apps/pod/logs?container=web&previous=true")
	w = h.request("GET", path, "operator", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "real log line") {
		t.Fatalf("logs: %d %s", w.Code, w.Body.String())
	}
	if w = h.request("GET", path, "viewer", ""); w.Code != 403 {
		t.Fatal("viewer logs")
	}
	if w = h.request("GET", h.path("/resources/pods/apps/pod/logs?container=outside"), "operator", ""); w.Code != 400 {
		t.Fatal("unrelated container allowed")
	}
}
func TestKubeQuantities(t *testing.T) {
	for s, want := range map[string]float64{"500m": .5, "250000000n": .25, "1Gi": 1073741824, "250Mi": 262144000, "2": 2, "1e3": 1000} {
		got, e := kubeQuantity(s)
		if e != nil || got != want {
			t.Fatalf("%s: %f %v", s, got, e)
		}
	}
}

func TestKubeDisconnectCannotDeleteClusterResources(t *testing.T) {
	h := newKubeHarness(t)
	for _, role := range []string{"viewer", "operator"} {
		if w := h.request("DELETE", "/clusters/"+h.profile.ID, role, ""); w.Code != 403 {
			t.Fatalf("role %s: %d", role, w.Code)
		}
	}
	if w := h.request("DELETE", "/clusters/"+h.profile.ID, "admin", ""); w.Code != 200 {
		t.Fatalf("disconnect: %d", w.Code)
	}
	if len(h.calls) != 0 {
		t.Fatal("removing a connection contacted the cluster")
	}
	if _, e := h.manager.load(h.profile.ID); e == nil {
		t.Fatal("connection still present")
	}
}
func TestKubeRedirectsDoNotForwardCredentials(t *testing.T) {
	calls := 0
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(200) }))
	defer target.Close()
	redirect := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/credential-target", 307)
	}))
	defer redirect.Close()
	cert, _ := x509.ParseCertificate(redirect.TLS.Certificates[0].Certificate[0])
	p := kubeProfile{Server: redirect.URL, Token: "private-token", CA: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw}))}
	c, e := newKubeClient(p)
	if e != nil {
		t.Fatal(e)
	}
	defer c.close()
	if _, e = c.call(t.Context(), "GET", "/version", "", nil); e == nil {
		t.Fatal("redirect accepted")
	}
	if calls != 0 {
		t.Fatal("credentials forwarded to redirected origin")
	}
}
func TestKubeRolloutDoesNotConfirmOldSurgeReplicas(t *testing.T) {
	o := kubeTestObject("Deployment", "api", "apps")
	status := ko(o["status"])
	status["availableReplicas"] = float64(2)
	status["replicas"] = float64(3)
	if r := kubeMap("deployments", o); r.Ready {
		t.Fatal("rollout considered finished while old replicas remain")
	}
	status["replicas"] = float64(2)
	if r := kubeMap("deployments", o); !r.Ready {
		t.Fatal("complete rollout not available")
	}
	status["observedGeneration"] = float64(1)
	if r := kubeMap("deployments", o); r.Ready {
		t.Fatal("old controller observation considered current")
	}
}
