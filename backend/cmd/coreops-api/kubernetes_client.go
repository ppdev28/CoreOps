package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// This adapter deliberately accepts embedded credentials only: never execute a
// kubeconfig credential plugin or read client-supplied paths on the CoreOps host.
type kubeProfile struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Server      string   `json:"server"`
	Namespaces  []string `json:"namespaces"`
	CA          string   `json:"ca,omitempty"`
	Token       string   `json:"token,omitempty"`
	Certificate string   `json:"certificate,omitempty"`
	Key         string   `json:"key,omitempty"`
}
type kubeCluster struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Server     string   `json:"server"`
	Namespaces []string `json:"namespaces"`
}

func (p kubeProfile) public() kubeCluster { return kubeCluster{p.ID, p.Name, p.Server, p.Namespaces} }

type kubeManager struct {
	dir string
	mu  sync.Mutex
}

func newKubeManager(dir string) *kubeManager { return &kubeManager{dir: dir} }

var kubeName = regexp.MustCompile(`^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$`)

func validKubeName(s string) bool { return len(s) > 0 && len(s) <= 253 && kubeName.MatchString(s) }
func (m *kubeManager) load(id string) (kubeProfile, error) {
	if len(id) != 20 {
		return kubeProfile{}, &kubeError{404, "Cluster connection not found"}
	}
	if _, err := hex.DecodeString(id); err != nil {
		return kubeProfile{}, &kubeError{404, "Cluster connection not found"}
	}
	b, err := os.ReadFile(filepath.Join(m.dir, id+".json"))
	if err != nil {
		return kubeProfile{}, &kubeError{404, "Cluster connection not found"}
	}
	var p kubeProfile
	if json.Unmarshal(b, &p) != nil || p.ID != id {
		return p, errors.New("Cannot read cluster connection")
	}
	return p, nil
}
func (m *kubeManager) list() ([]kubeCluster, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []kubeCluster{}
	entries, err := os.ReadDir(m.dir)
	if os.IsNotExist(err) {
		return out, nil
	}
	if err != nil {
		return nil, errors.New("Cannot read cluster connections")
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".json") {
			p, err := m.load(strings.TrimSuffix(e.Name(), ".json"))
			if err != nil {
				return nil, err
			}
			out = append(out, p.public())
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}
func (m *kubeManager) save(p kubeProfile) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := os.MkdirAll(m.dir, 0700); err != nil {
		return errors.New("Cannot store cluster connection")
	}
	// Publish a completely written file without overwriting another process's
	// connection. Readers never observe partial credential JSON.
	f, err := os.CreateTemp(m.dir, ".connection-*")
	if err != nil {
		return errors.New("Cannot store cluster connection")
	}
	defer func() {
		_ = f.Close()
		_ = os.Remove(f.Name())
	}()
	if err = json.NewEncoder(f).Encode(p); err != nil {
		return errors.New("Cannot store cluster connection")
	}
	if f.Sync() != nil {
		return errors.New("Cannot store cluster connection")
	}
	if err = f.Close(); err != nil {
		return errors.New("Cannot store cluster connection")
	}
	if err = os.Link(f.Name(), filepath.Join(m.dir, p.ID+".json")); os.IsExist(err) {
		return &kubeError{409, "This cluster name is already configured"}
	} else if err != nil {
		return errors.New("Cannot store cluster connection")
	}
	return nil
}

func kubeBounded(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		h(w, r.WithContext(ctx))
	}
}

type kubeError struct {
	status  int
	message string
}

func (e *kubeError) Error() string { return e.message }
func kubeWriteError(w http.ResponseWriter, err error) {
	var e *kubeError
	if errors.As(err, &e) {
		writeError(w, e.status, e)
	} else {
		writeError(w, 502, errors.New("Kubernetes is unavailable. Check the connection, certificate and credentials."))
	}
}
func kubeHTTPClient(p kubeProfile) (*http.Client, error) {
	u, err := url.Parse(p.Server)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, &kubeError{400, "API server must be an HTTPS origin without a path or credentials"}
	}
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if p.CA != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(p.CA)) {
			return nil, &kubeError{400, "Invalid PEM certificate authority"}
		}
		cfg.RootCAs = pool
	}
	if p.Certificate != "" || p.Key != "" {
		cert, err := tls.X509KeyPair([]byte(p.Certificate), []byte(p.Key))
		if err != nil {
			return nil, &kubeError{400, "Invalid client certificate or key"}
		}
		cfg.Certificates = []tls.Certificate{cert}
	}
	if (p.Token == "") == (len(cfg.Certificates) == 0) {
		return nil, &kubeError{400, "Provide either a bearer token or a client certificate and key"}
	}
	if strings.ContainsAny(p.Token, "\r\n") {
		return nil, &kubeError{400, "Invalid bearer token"}
	}
	tr := &http.Transport{TLSClientConfig: cfg, Proxy: nil, MaxIdleConnsPerHost: 4, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 10 * time.Second, IdleConnTimeout: 15 * time.Second}
	return &http.Client{Transport: tr, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, nil
}

type kubeClient struct {
	profile kubeProfile
	http    *http.Client
}

func newKubeClient(p kubeProfile) (*kubeClient, error) {
	h, e := kubeHTTPClient(p)
	return &kubeClient{p, h}, e
}
func (c *kubeClient) close() {
	if c.http != nil {
		c.http.CloseIdleConnections()
	}
}
func (c *kubeClient) call(ctx context.Context, method, path, contentType string, body any) ([]byte, error) {
	var data []byte
	var err error
	if body != nil {
		data, err = json.Marshal(body)
		if err != nil {
			return nil, err
		}
	}
	r, err := http.NewRequestWithContext(ctx, method, strings.TrimSuffix(c.profile.Server, "/")+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	r.Header.Set("Accept", "application/json")
	if c.profile.Token != "" {
		r.Header.Set("Authorization", "Bearer "+c.profile.Token)
	}
	if body != nil {
		r.Header.Set("Content-Type", contentType)
	}
	res, err := c.http.Do(r)
	if err != nil {
		return nil, errors.New("Kubernetes connection failed")
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case 401:
		return nil, &kubeError{502, "Cluster credentials were rejected or have expired"}
	case 403:
		return nil, &kubeError{403, "Cluster RBAC does not permit this operation"}
	case 404:
		return nil, &kubeError{404, "Kubernetes resource or API not found"}
	case 409:
		return nil, &kubeError{409, "Resource changed. Refresh its detail before trying again"}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, &kubeError{502, fmt.Sprintf("Kubernetes API returned HTTP %d; no operation is retried automatically", res.StatusCode)}
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 8*1024*1024+1))
	if err != nil {
		return nil, errors.New("Kubernetes response interrupted")
	}
	if len(b) > 8*1024*1024 {
		return nil, &kubeError{502, "Kubernetes response exceeds the supported size; narrow the namespace scope"}
	}
	return b, nil
}
func (c *kubeClient) get(ctx context.Context, path string, out any) error {
	b, e := c.call(ctx, "GET", path, "", nil)
	if e != nil {
		return e
	}
	if json.Unmarshal(b, out) != nil {
		return errors.New("Invalid Kubernetes response")
	}
	return nil
}
func (c *kubeClient) allowed(ctx context.Context, namespace, resource, subresource, verb, name string) bool {
	group := "apps"
	if resource == "pods" {
		group = ""
	}
	body := map[string]any{"apiVersion": "authorization.k8s.io/v1", "kind": "SelfSubjectAccessReview", "spec": map[string]any{"resourceAttributes": map[string]string{"group": group, "namespace": namespace, "resource": resource, "subresource": subresource, "verb": verb, "name": name}}}
	b, e := c.call(ctx, "POST", "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews", "application/json", body)
	if e != nil {
		return false
	}
	var out struct {
		Status struct {
			Allowed bool `json:"allowed"`
		} `json:"status"`
	}
	return json.Unmarshal(b, &out) == nil && out.Status.Allowed
}
func (c *kubeClient) namespaces(ctx context.Context) ([]string, error) {
	if len(c.profile.Namespaces) == 1 && c.profile.Namespaces[0] == "*" {
		var list struct {
			Metadata struct {
				Continue string `json:"continue"`
			} `json:"metadata"`
			Items []struct {
				Metadata struct {
					Name string `json:"name"`
				} `json:"metadata"`
			} `json:"items"`
		}
		if e := c.get(ctx, "/api/v1/namespaces?limit=2000", &list); e != nil {
			return nil, e
		}
		if list.Items == nil {
			return nil, errors.New("Invalid Kubernetes namespace response")
		}
		if list.Metadata.Continue != "" {
			return nil, &kubeError{502, "Too many namespaces; configure an explicit permitted scope"}
		}
		ns := []string{}
		for _, i := range list.Items {
			ns = append(ns, i.Metadata.Name)
		}
		sort.Strings(ns)
		return ns, nil
	}
	return c.profile.Namespaces, nil
}
func (c *kubeClient) scope(namespace string) error {
	if !validKubeName(namespace) {
		return &kubeError{400, "Invalid namespace"}
	}
	for _, ns := range c.profile.Namespaces {
		if ns == "*" || ns == namespace {
			return nil
		}
	}
	return &kubeError{403, "Namespace is outside this connection's permitted scope"}
}
func kubePath(kind, ns, name string) (string, error) {
	base := "/apis/apps/v1"
	switch kind {
	case "pods", "nodes", "events":
		base = "/api/v1"
	case "deployments", "statefulsets", "daemonsets":
	default:
		return "", &kubeError{400, "Unsupported resource kind"}
	}
	if kind != "nodes" && ns != "" {
		base += "/namespaces/" + url.PathEscape(ns)
	}
	base += "/" + kind
	if name != "" {
		if !validKubeName(name) {
			return "", &kubeError{400, "Invalid resource name"}
		}
		base += "/" + url.PathEscape(name)
	}
	return base, nil
}
func (c *kubeClient) list(ctx context.Context, kind, ns string) ([]kubeObject, error) {
	scopes := []string{ns}
	if kind == "nodes" {
		scopes = []string{""}
	} else if ns == "" {
		if len(c.profile.Namespaces) == 1 && c.profile.Namespaces[0] == "*" {
			scopes = []string{""}
		} else {
			scopes = c.profile.Namespaces
		}
	}
	out := []kubeObject{}
	for _, scope := range scopes {
		path, e := kubePath(kind, scope, "")
		if e != nil {
			return nil, e
		}
		cursor := ""
		for {
			var page struct {
				Items    []kubeObject `json:"items"`
				Metadata struct {
					Continue string `json:"continue"`
				} `json:"metadata"`
			}
			q := url.Values{"limit": {"500"}}
			if cursor != "" {
				q.Set("continue", cursor)
			}
			if e = c.get(ctx, path+"?"+q.Encode(), &page); e != nil {
				return nil, e
			}
			if page.Items == nil {
				return nil, errors.New("Invalid Kubernetes list response")
			}
			out = append(out, page.Items...)
			cursor = page.Metadata.Continue
			if len(out) > 4000 || len(out) == 4000 && cursor != "" {
				return nil, &kubeError{502, "Too many resources; select a smaller namespace scope"}
			}
			if cursor == "" {
				break
			}
		}
	}
	return out, nil
}
func (a *API) kubeClusters(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	list, e := a.kube.list()
	if e != nil {
		kubeWriteError(w, e)
		return
	}
	writeJSON(w, 200, list)
}
func (a *API) kubeConnect(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var p kubeProfile
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024))
	d.DisallowUnknownFields()
	if d.Decode(&p) != nil || d.Decode(&struct{}{}) != io.EOF {
		writeError(w, 400, errors.New("Invalid connection configuration"))
		return
	}
	p.Name = strings.TrimSpace(p.Name)
	p.Server = strings.TrimRight(strings.TrimSpace(p.Server), "/")
	p.Token = strings.TrimSpace(p.Token)
	if p.ID != "" || len(p.Name) < 1 || len(p.Name) > 80 || strings.ContainsAny(p.Name, "\r\n\x00") || len(p.Namespaces) == 0 || len(p.Namespaces) > 50 {
		writeError(w, 400, errors.New("Provide a name and between 1 and 50 permitted namespaces"))
		return
	}
	seen := map[string]bool{}
	for _, ns := range p.Namespaces {
		if seen[ns] || (!validKubeName(ns) && !(ns == "*" && len(p.Namespaces) == 1)) {
			writeError(w, 400, errors.New("Invalid or duplicate permitted namespace"))
			return
		}
		seen[ns] = true
	}
	sum := sha256.Sum256([]byte(p.Name))
	p.ID = hex.EncodeToString(sum[:10])
	setAuditDetail(r, "kubernetes connect cluster="+p.ID)
	c, e := newKubeClient(p)
	if e != nil {
		kubeWriteError(w, e)
		return
	}
	defer c.close()
	var v map[string]any
	if e = c.get(r.Context(), "/version", &v); e != nil {
		kubeWriteError(w, e)
		return
	}
	if version, ok := v["gitVersion"].(string); !ok || !strings.HasPrefix(version, "v") {
		kubeWriteError(w, errors.New("Not a Kubernetes API"))
		return
	}
	// Test namespace scope before storing any credentials. RBAC failures remain explicit.
	if _, e = c.namespaces(r.Context()); e != nil {
		kubeWriteError(w, e)
		return
	}
	if e = a.kube.save(p); e != nil {
		kubeWriteError(w, e)
		return
	}
	writeJSON(w, 201, p.public())
}
func (a *API) kubeDisconnect(w http.ResponseWriter, r *http.Request) {
	p, e := a.kube.load(r.PathValue("cluster"))
	if e != nil {
		kubeWriteError(w, e)
		return
	}
	setAuditDetail(r, "kubernetes disconnect cluster="+p.ID)
	if e = os.Remove(filepath.Join(a.kube.dir, p.ID+".json")); e != nil {
		kubeWriteError(w, e)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (a *API) kubeRequest(r *http.Request) (*kubeClient, error) {
	p, e := a.kube.load(r.PathValue("cluster"))
	if e != nil {
		return nil, e
	}
	return newKubeClient(p)
}
