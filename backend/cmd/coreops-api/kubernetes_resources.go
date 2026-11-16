package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type kubeObject map[string]any

func ko(v any) kubeObject { m, _ := v.(map[string]any); return m }
func (k kubeObject) at(path ...string) any {
	var v any = map[string]any(k)
	for _, p := range path {
		v = ko(v)[p]
	}
	return v
}
func (k kubeObject) s(path ...string) string { s, _ := k.at(path...).(string); return s }
func (k kubeObject) n(path ...string) int    { n, _ := k.at(path...).(float64); return int(n) }
func (k kubeObject) b(path ...string) bool   { b, _ := k.at(path...).(bool); return b }
func (k kubeObject) items(path ...string) []kubeObject {
	a, _ := k.at(path...).([]any)
	out := []kubeObject{}
	for _, v := range a {
		out = append(out, ko(v))
	}
	return out
}

type kubeCondition struct {
	Type    string `json:"type"`
	Status  string `json:"status"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
}
type kubeContainer struct {
	Name     string            `json:"name"`
	Image    string            `json:"image"`
	Ready    bool              `json:"ready"`
	Restarts int               `json:"restarts"`
	State    string            `json:"state"`
	Reason   string            `json:"reason"`
	Message  string            `json:"message"`
	Init     bool              `json:"init"`
	Requests map[string]string `json:"requests"`
	Limits   map[string]string `json:"limits"`
}
type kubeResource struct {
	Kind               string          `json:"kind"`
	Name               string          `json:"name"`
	Namespace          string          `json:"namespace"`
	UID                string          `json:"uid"`
	Version            string          `json:"version"`
	Created            string          `json:"created"`
	Phase              string          `json:"phase"`
	Ready              bool            `json:"ready"`
	Problem            bool            `json:"problem"`
	Reason             string          `json:"reason"`
	Message            string          `json:"message"`
	Available          int             `json:"available"`
	Desired            int             `json:"desired"`
	Updated            int             `json:"updated"`
	Restarts           int             `json:"restarts"`
	Node               string          `json:"node"`
	Images             []string        `json:"images"`
	Conditions         []kubeCondition `json:"conditions"`
	Containers         []kubeContainer `json:"containers"`
	CPU                string          `json:"cpu"`
	Memory             string          `json:"memory"`
	AllocatableCPU     string          `json:"allocatableCpu"`
	AllocatableMemory  string          `json:"allocatableMemory"`
	PodCount           *int            `json:"podCount"`
	Owners             []string        `json:"owners"`
	Generation         int             `json:"generation"`
	ObservedGeneration int             `json:"observedGeneration"`
}

func stringMap(v any) map[string]string {
	m := map[string]string{}
	for k, v := range ko(v) {
		if s, ok := v.(string); ok {
			m[k] = s
		}
	}
	return m
}
func kubeMap(kind string, o kubeObject) kubeResource {
	r := kubeResource{Kind: kind, Name: o.s("metadata", "name"), Namespace: o.s("metadata", "namespace"), UID: o.s("metadata", "uid"), Version: o.s("metadata", "resourceVersion"), Created: o.s("metadata", "creationTimestamp"), Phase: o.s("status", "phase"), Reason: o.s("status", "reason"), Message: o.s("status", "message"), Images: []string{}, Conditions: []kubeCondition{}, Containers: []kubeContainer{}, Owners: []string{}, Generation: o.n("metadata", "generation"), ObservedGeneration: o.n("status", "observedGeneration")}
	for _, c := range o.items("status", "conditions") {
		r.Conditions = append(r.Conditions, kubeCondition{c.s("type"), c.s("status"), c.s("reason"), c.s("message")})
	}
	for _, owner := range o.items("metadata", "ownerReferences") {
		r.Owners = append(r.Owners, owner.s("uid"))
	}
	switch kind {
	case "pods":
		r.Node = o.s("spec", "nodeName")
		for _, group := range []struct {
			spec, status string
			init         bool
		}{{"containers", "containerStatuses", false}, {"initContainers", "initContainerStatuses", true}} {
			for _, spec := range o.items("spec", group.spec) {
				c := kubeContainer{Name: spec.s("name"), Image: spec.s("image"), State: "Unknown", Init: group.init, Requests: stringMap(spec.at("resources", "requests")), Limits: stringMap(spec.at("resources", "limits"))}
				for _, st := range o.items("status", group.status) {
					if st.s("name") != c.Name {
						continue
					}
					c.Ready = st.b("ready")
					c.Restarts = st.n("restartCount")
					for _, state := range []string{"running", "waiting", "terminated"} {
						if st.at("state", state) != nil {
							c.State = state
							c.Reason = st.s("state", state, "reason")
							c.Message = st.s("state", state, "message")
						}
					}
				}
				r.Containers = append(r.Containers, c)
				r.Images = append(r.Images, c.Image)
				r.Restarts += c.Restarts
				if !c.Init {
					r.Desired++
					if c.Ready {
						r.Available++
					}
				}
				if c.State == "waiting" && c.Reason != "ContainerCreating" && c.Reason != "PodInitializing" || c.State == "terminated" && c.Reason != "Completed" || c.Restarts >= 3 {
					r.Problem = true
					if r.Reason == "" {
						r.Reason = c.Reason
						r.Message = c.Message
					}
				}
			}
		}
		for _, c := range r.Conditions {
			if c.Type == "Ready" {
				r.Ready = c.Status == "True"
			}
			if c.Type == "PodScheduled" && c.Status == "False" {
				r.Problem = true
				r.Reason = c.Reason
				r.Message = c.Message
			}
		}
		if r.Phase == "Failed" || r.Phase == "Unknown" {
			r.Problem = true
		}
		if r.Phase == "Running" && !r.Ready {
			r.Problem = true
		}
	case "nodes":
		for _, c := range r.Conditions {
			if c.Type == "Ready" {
				r.Ready = c.Status == "True"
			}
			if c.Type != "Ready" && c.Status == "True" {
				r.Problem = true
				r.Reason = c.Reason
				r.Message = c.Message
			}
		}
		r.Problem = r.Problem || !r.Ready
		r.CPU = o.s("status", "capacity", "cpu")
		r.Memory = o.s("status", "capacity", "memory")
		r.AllocatableCPU = o.s("status", "allocatable", "cpu")
		r.AllocatableMemory = o.s("status", "allocatable", "memory")
	default:
		r.Desired = 1
		if o.at("spec", "replicas") != nil {
			r.Desired = o.n("spec", "replicas")
		}
		r.Available = o.n("status", "availableReplicas")
		r.Updated = o.n("status", "updatedReplicas")
		if kind == "statefulsets" {
			r.Available = o.n("status", "readyReplicas")
		}
		if kind == "daemonsets" {
			r.Desired = o.n("status", "desiredNumberScheduled")
			r.Available = o.n("status", "numberAvailable")
			r.Updated = o.n("status", "updatedNumberScheduled")
		}
		r.Ready = r.Available >= r.Desired && r.Updated >= r.Desired && r.ObservedGeneration >= r.Generation
		if kind == "deployments" {
			r.Ready = r.Ready && o.n("status", "replicas") == r.Desired
		}
		r.Problem = !r.Ready
		for _, c := range o.items("spec", "template", "spec", "containers") {
			r.Images = append(r.Images, c.s("image"))
		}
		for _, c := range r.Conditions {
			if c.Status == "False" && c.Type == "Available" || c.Reason == "ProgressDeadlineExceeded" || c.Type == "ReplicaFailure" && c.Status == "True" {
				r.Reason = c.Reason
				r.Message = c.Message
			}
		}
	}
	return r
}

type kubeEvent struct {
	UID         string `json:"uid"`
	ResourceUID string `json:"resourceUid"`
	Resource    string `json:"resource"`
	Namespace   string `json:"namespace"`
	Type        string `json:"type"`
	Reason      string `json:"reason"`
	Message     string `json:"message"`
	Time        string `json:"time"`
	Count       int    `json:"count"`
}

func kubeMapEvent(o kubeObject) kubeEvent {
	stamp := o.s("series", "lastObservedTime")
	if stamp == "" {
		stamp = o.s("lastTimestamp")
	}
	if stamp == "" {
		stamp = o.s("eventTime")
	}
	if stamp == "" {
		stamp = o.s("metadata", "creationTimestamp")
	}
	return kubeEvent{o.s("metadata", "uid"), o.s("involvedObject", "uid"), o.s("involvedObject", "name"), o.s("metadata", "namespace"), o.s("type"), o.s("reason"), o.s("message"), stamp, o.n("count")}
}

type kubeMetrics struct {
	CPU    float64 `json:"cpuCores"`
	Memory float64 `json:"memoryBytes"`
	Nodes  int     `json:"nodes"`
	Time   string  `json:"time"`
	Window string  `json:"window"`
}

func kubeQuantity(s string) (float64, error) {
	for _, suffix := range []struct {
		s string
		n float64
	}{{"Ki", 1024}, {"Mi", math.Pow(1024, 2)}, {"Gi", math.Pow(1024, 3)}, {"Ti", math.Pow(1024, 4)}, {"Pi", math.Pow(1024, 5)}, {"Ei", math.Pow(1024, 6)}, {"n", 1e-9}, {"u", 1e-6}, {"m", 1e-3}, {"k", 1e3}, {"M", 1e6}, {"G", 1e9}, {"T", 1e12}, {"P", 1e15}, {"E", 1e18}} {
		if strings.HasSuffix(s, suffix.s) {
			n, e := strconv.ParseFloat(strings.TrimSuffix(s, suffix.s), 64)
			return n * suffix.n, e
		}
	}
	return strconv.ParseFloat(s, 64)
}

type kubeSnapshot struct {
	Namespaces []string                     `json:"namespaces"`
	Resources  map[string][]kubeResource    `json:"resources"`
	Events     []kubeEvent                  `json:"events"`
	Errors     map[string]string            `json:"errors"`
	Metrics    *kubeMetrics                 `json:"metrics"`
	NodeUsage  map[string]map[string]string `json:"nodeUsage"`
	UpdatedAt  string                       `json:"updatedAt"`
}

func (a *API) kubeSnapshot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	c, e := a.kubeRequest(r)
	if e != nil {
		kubeWriteError(w, e)
		return
	}
	defer c.close()
	ns := r.URL.Query().Get("namespace")
	if ns != "" {
		if e = c.scope(ns); e != nil {
			kubeWriteError(w, e)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	namespaces, e := c.namespaces(ctx)
	if e != nil {
		kubeWriteError(w, e)
		return
	}
	out := kubeSnapshot{Namespaces: namespaces, Resources: map[string][]kubeResource{}, Events: []kubeEvent{}, Errors: map[string]string{}, NodeUsage: map[string]map[string]string{}}
	// Bound fan-out and preserve errors per collection; a denied list is never a zero count.
	type result struct {
		kind    string
		objects []kubeObject
		err     error
	}
	ch := make(chan result, 7)
	var connectionFailure error
	readable := 0
	for _, kind := range []string{"deployments", "statefulsets", "daemonsets", "pods", "nodes", "events"} {
		go func(kind string) { list, e := c.list(ctx, kind, ns); ch <- result{kind, list, e} }(kind)
	}
	for i := 0; i < 6; i++ {
		v := <-ch
		if v.err != nil {
			out.Errors[v.kind] = v.err.Error()
			var upstream *kubeError
			if !errors.As(v.err, &upstream) || upstream.status >= 500 {
				connectionFailure = v.err
			}
			continue
		}
		readable++
		if v.kind == "events" {
			for _, o := range v.objects {
				out.Events = append(out.Events, kubeMapEvent(o))
			}
			continue
		}
		out.Resources[v.kind] = []kubeResource{}
		for _, o := range v.objects {
			out.Resources[v.kind] = append(out.Resources[v.kind], kubeMap(v.kind, o))
		}
	}
	if readable == 0 && connectionFailure != nil {
		kubeWriteError(w, connectionFailure)
		return
	}
	// Node pod counts must describe the entire permitted scope, never only the selected namespace.
	if ns == "" && out.Errors["pods"] == "" {
		for i, n := range out.Resources["nodes"] {
			count := 0
			for _, p := range out.Resources["pods"] {
				if p.Node == n.Name {
					count++
				}
			}
			out.Resources["nodes"][i].PodCount = &count
		}
	}
	var metrics kubeObject
	if e = c.get(ctx, "/apis/metrics.k8s.io/v1beta1/nodes", &metrics); e != nil {
		out.Errors["metrics"] = "Metrics API is unavailable or not permitted; no usage values are estimated."
	} else {
		m := &kubeMetrics{}
		valid := true
		for _, v := range metrics.items("items") {
			cpu, e1 := kubeQuantity(v.s("usage", "cpu"))
			mem, e2 := kubeQuantity(v.s("usage", "memory"))
			if e1 != nil || e2 != nil || math.IsNaN(cpu) || math.IsInf(cpu, 0) || math.IsNaN(mem) || math.IsInf(mem, 0) || cpu < 0 || mem < 0 || v.s("timestamp") == "" {
				valid = false
				break
			}
			m.CPU += cpu
			m.Memory += mem
			m.Nodes++
			if m.Time == "" || v.s("timestamp") < m.Time {
				m.Time = v.s("timestamp")
				m.Window = v.s("window")
			}
			out.NodeUsage[v.s("metadata", "name")] = map[string]string{"cpu": v.s("usage", "cpu"), "memory": v.s("usage", "memory")}
		}
		if valid && m.Nodes > 0 {
			out.Metrics = m
		} else {
			out.Errors["metrics"] = "Metrics API returned no usable samples."
			out.NodeUsage = map[string]map[string]string{}
		}
	}
	sort.Slice(out.Events, func(i, j int) bool { return out.Events[i].Time > out.Events[j].Time })
	out.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	writeJSON(w, 200, out)
}
func (a *API) kubeResourceRequest(r *http.Request) (*kubeClient, string, kubeObject, error) {
	c, e := a.kubeRequest(r)
	if e != nil {
		return nil, "", nil, e
	}
	ns, kind, name := r.PathValue("namespace"), r.PathValue("kind"), r.PathValue("name")
	if kind == "" {
		kind = "pods"
	}
	if kind == "nodes" {
		if ns != "_" {
			c.close()
			return nil, "", nil, &kubeError{400, "Nodes are cluster scoped"}
		}
		ns = ""
	} else if ns == "_" {
		c.close()
		return nil, "", nil, &kubeError{400, "A resource namespace is required"}
	}
	if ns != "" {
		if e = c.scope(ns); e != nil {
			c.close()
			return nil, "", nil, e
		}
	}
	path, e := kubePath(kind, ns, name)
	if e != nil {
		c.close()
		return nil, "", nil, e
	}
	var object kubeObject
	if e = c.get(r.Context(), path, &object); e != nil {
		c.close()
		return nil, "", nil, e
	}
	return c, path, object, nil
}

// Selector matching uses all Kubernetes LabelSelector operators. An empty or
// unsupported selector never silently matches every pod.
func kubeMatches(selector kubeObject, labels kubeObject) bool {
	if len(ko(selector["matchLabels"])) == 0 && len(selector.items("matchExpressions")) == 0 {
		return false
	}
	for k, v := range ko(selector["matchLabels"]) {
		if labels[k] != v {
			return false
		}
	}
	for _, e := range selector.items("matchExpressions") {
		key, op := e.s("key"), e.s("operator")
		v, exists := labels[key]
		found := false
		values, _ := e.at("values").([]any)
		for _, allowed := range values {
			if v == allowed {
				found = true
			}
		}
		switch op {
		case "In":
			if !exists || !found {
				return false
			}
		case "NotIn":
			if exists && found {
				return false
			}
		case "Exists":
			if !exists {
				return false
			}
		case "DoesNotExist":
			if exists {
				return false
			}
		default:
			return false
		}
	}
	return true
}
func (a *API) kubeDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	c, _, o, e := a.kubeResourceRequest(r)
	if e != nil {
		kubeWriteError(w, e)
		return
	}
	defer c.close()
	kind := r.PathValue("kind")
	res := kubeMap(kind, o)
	user, _ := userFromContext(r.Context())
	canOperate := user.Role.rank() >= RoleOperator.rank()
	permissions := map[string]bool{"scale": false, "restart": false, "logs": false, "yaml": canOperate}
	actionNote := ""
	if kind == "deployments" && canOperate {
		permissions["scale"] = c.allowed(r.Context(), res.Namespace, "deployments", "scale", "patch", res.Name)
		permissions["restart"] = c.allowed(r.Context(), res.Namespace, "deployments", "", "patch", res.Name)
		if o.b("spec", "paused") || o.s("metadata", "deletionTimestamp") != "" {
			permissions["scale"] = false
			permissions["restart"] = false
			actionNote = "This Deployment is paused or terminating. Scale and restart are unavailable."
		} else if o.s("spec", "strategy", "type") == "Recreate" {
			permissions["restart"] = false
			actionNote = "This Deployment uses Recreate. A rolling restart is unavailable."
		}
	}
	if kind == "pods" && canOperate {
		permissions["logs"] = c.allowed(r.Context(), res.Namespace, "pods", "log", "get", res.Name)
	}
	pods := []kubeResource{}
	errMap := map[string]string{}
	if kind != "pods" {
		scope := res.Namespace
		list, e := c.list(r.Context(), "pods", scope)
		if e != nil {
			errMap["pods"] = e.Error()
		} else {
			for _, p := range list {
				if kind == "nodes" && p.s("spec", "nodeName") == res.Name || kind != "nodes" && kubeMatches(ko(o.at("spec", "selector")), ko(p.at("metadata", "labels"))) {
					pods = append(pods, kubeMap("pods", p))
				}
			}
		}
	}
	events := []kubeEvent{}
	list, e := c.list(r.Context(), "events", res.Namespace)
	if e != nil {
		errMap["events"] = e.Error()
	} else {
		uids := map[string]bool{res.UID: true}
		for _, p := range pods {
			uids[p.UID] = true
		}
		for _, ev := range list {
			v := kubeMapEvent(ev)
			if uids[v.ResourceUID] {
				events = append(events, v)
			}
		}
	}
	sort.Slice(events, func(i, j int) bool { return events[i].Time > events[j].Time })
	writeJSON(w, 200, map[string]any{"resource": res, "pods": pods, "events": events, "permissions": permissions, "errors": errMap, "actionNote": actionNote})
}
func (a *API) kubeYAML(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	c, _, o, e := a.kubeResourceRequest(r)
	if e != nil {
		kubeWriteError(w, e)
		return
	}
	defer c.close()
	delete(ko(o["metadata"]), "managedFields")
	delete(ko(ko(o["metadata"])["annotations"]), "kubectl.kubernetes.io/last-applied-configuration")
	b, e := yaml.Marshal(map[string]any(o))
	if e != nil {
		kubeWriteError(w, e)
		return
	}
	writeJSON(w, 200, map[string]string{"yaml": string(b)})
}
func (a *API) kubeLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	c, path, o, e := a.kubeResourceRequest(r)
	if e != nil {
		kubeWriteError(w, e)
		return
	}
	defer c.close()
	container := r.URL.Query().Get("container")
	found := false
	for _, group := range []string{"containers", "initContainers"} {
		for _, v := range o.items("spec", group) {
			if v.s("name") == container {
				found = true
			}
		}
	}
	if !found {
		writeError(w, 400, errors.New("Select a container belonging to this pod"))
		return
	}
	previous := r.URL.Query().Get("previous")
	if previous != "" && previous != "true" && previous != "false" {
		writeError(w, 400, errors.New("Invalid previous-log selection"))
		return
	}
	q := url.Values{"container": {container}, "tailLines": {"1000"}, "limitBytes": {"262144"}, "timestamps": {"true"}, "previous": {strconv.FormatBool(previous == "true")}}
	b, e := c.call(r.Context(), "GET", path+"/log?"+q.Encode(), "", nil)
	if e != nil {
		kubeWriteError(w, e)
		return
	}
	writeJSON(w, 200, map[string]string{"text": string(b), "updatedAt": time.Now().UTC().Format(time.RFC3339)})
}
func (a *API) kubeAction(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	action := r.PathValue("action")
	if action != "scale" && action != "restart" {
		writeError(w, 400, errors.New("Unsupported Deployment action"))
		return
	}
	var body struct {
		UID      string `json:"uid"`
		Version  string `json:"version"`
		Replicas *int   `json:"replicas,omitempty"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	d.DisallowUnknownFields()
	if d.Decode(&body) != nil || d.Decode(&struct{}{}) != io.EOF || body.UID == "" || body.Version == "" || action == "scale" && (body.Replicas == nil || *body.Replicas < 0 || *body.Replicas > 1000) || action == "restart" && body.Replicas != nil {
		writeError(w, 400, errors.New("Provide the current resource identity/version and a replica count from 0 to 1000 for scaling"))
		return
	}
	r.SetPathValue("kind", "deployments")
	c, path, o, e := a.kubeResourceRequest(r)
	if e != nil {
		kubeWriteError(w, e)
		return
	}
	defer c.close()
	if o.s("metadata", "uid") != body.UID || o.s("metadata", "resourceVersion") != body.Version {
		writeError(w, 409, errors.New("Deployment changed. Refresh and review the action again"))
		return
	}
	if o.b("spec", "paused") || o.s("metadata", "deletionTimestamp") != "" {
		writeError(w, 409, errors.New("Deployment is paused or terminating; this action is unavailable"))
		return
	}
	if action == "restart" && o.s("spec", "strategy", "type") == "Recreate" {
		writeError(w, 409, errors.New("This Deployment uses Recreate; a rolling restart is unavailable"))
		return
	}
	sub := ""
	if action == "scale" {
		sub = "scale"
	}
	if !c.allowed(r.Context(), r.PathValue("namespace"), "deployments", sub, "patch", r.PathValue("name")) {
		writeError(w, 403, errors.New("Cluster RBAC does not permit this Deployment action"))
		return
	}
	setAuditDetail(r, fmt.Sprintf("kubernetes cluster=%s namespace=%s deployment=%s action=%s uid=%s", r.PathValue("cluster"), r.PathValue("namespace"), r.PathValue("name"), action, body.UID))
	patch := map[string]any{"metadata": map[string]any{"uid": body.UID, "resourceVersion": body.Version}}
	if action == "scale" {
		path += "/scale"
		patch["spec"] = map[string]any{"replicas": *body.Replicas}
		setAuditDetail(r, fmt.Sprintf("kubernetes cluster=%s namespace=%s deployment=%s scale=%d", r.PathValue("cluster"), r.PathValue("namespace"), r.PathValue("name"), *body.Replicas))
	} else {
		patch["spec"] = map[string]any{"template": map[string]any{"metadata": map[string]any{"annotations": map[string]string{"kubectl.kubernetes.io/restartedAt": time.Now().UTC().Format(time.RFC3339Nano)}}}}
	}
	if _, e = c.call(r.Context(), "PATCH", path, "application/merge-patch+json", patch); e != nil {
		var upstream *kubeError
		if !errors.As(e, &upstream) {
			e = &kubeError{502, "The Kubernetes response was interrupted; the change may have been accepted. Refresh the Deployment before retrying."}
		}
		kubeWriteError(w, e)
		return
	}
	writeJSON(w, 202, map[string]any{"accepted": true, "uid": body.UID, "action": action, "message": "Kubernetes accepted the change. Waiting for observed rollout state; acceptance does not mean recovery."})
}
