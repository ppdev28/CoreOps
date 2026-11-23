package main

import (
	"context"
	dockeradapter "github.com/ppdev28/CoreOps/backend/internal/adapters/docker"
	"github.com/ppdev28/CoreOps/backend/internal/adapters/linuxpower"
	"github.com/ppdev28/CoreOps/backend/internal/adapters/linuxsecurity"
	"github.com/ppdev28/CoreOps/backend/internal/adapters/linuxservices"
	"github.com/ppdev28/CoreOps/backend/internal/adapters/tailscalelocal"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
	"github.com/ppdev28/CoreOps/backend/internal/hostpower"
	"github.com/ppdev28/CoreOps/backend/internal/security"
	"github.com/ppdev28/CoreOps/backend/internal/tailscale"
	"github.com/ppdev28/CoreOps/backend/internal/telemetry"
	"github.com/ppdev28/CoreOps/backend/internal/transport/httpapi"
	"net/http"
	"path/filepath"
	"strings"
)

// routes builds the API router. Every route except health and login requires
// a session whose role is at least the one declared here:
//
//	viewer   read-only overviews
//	operator container/service/VM actions and sensitive reads (logs, env vars)
//	admin    shell access, security changes, package updates, audit log
func (a *API) routes(auth *AuthStore, audit *AuditLog) http.Handler {
	if a.serviceControl == nil {
		a.serviceControl = linuxservices.New()
	}
	if a.files != nil {
		a.files.privateDir = auth.dir
	}
	a.auditLogPath = audit.path
	if a.hostSecurity == nil {
		a.hostSecurity = security.New(linuxsecurity.New())
	}
	if a.updateTasks == nil {
		a.updateTasks = newUpdateJobs(aptRunner{}, audit)
	}
	if a.telemetry == nil {
		a.telemetry = telemetry.New("")
	}
	if a.observability == nil {
		service, _, err := newObservability()
		if err != nil {
			panic(err)
		} // main validates production configuration before constructing routes.
		a.observability = service
	}
	if a.kube == nil {
		a.kube = newKubeManager(filepath.Join(auth.dir, "kubernetes"))
	}
	if a.compose == nil {
		a.compose = newComposeManager(filepath.Join(auth.dir, "compose"), a.docker)
	}
	if a.tailscale == nil {
		a.tailscale = tailscale.New(tailscalelocal.New())
	}
	if a.securityScans == nil {
		a.securityScans = security.NewScanJobs(context.Background(), security.NoScanner())
	}
	mux := http.NewServeMux()
	if a.power == nil {
		a.power = hostpower.New(linuxpower.New())
	}
	a.terminals = newTerminalServer(auth, audit)
	if a.docker != nil {
		a.terminals.containers = containers.NewTerminal(dockeradapter.NewTerminal(a.docker))
	}
	if a.containers == nil {
		a.containers = containers.New(dockeradapter.NewContainers(a.docker))
	}
	containerHTTP := httpapi.NewContainers(a.containers)
	handle := func(pattern string, min Role, h http.HandlerFunc) {
		mux.HandleFunc(pattern, auth.require(min, h))
	}

	mux.HandleFunc("GET /api/v1/health", a.health)
	mux.HandleFunc("GET /metrics", a.telemetry.Metrics)
	mux.HandleFunc("POST /api/v1/auth/login", auth.loginHandler)
	handle("POST /api/v1/auth/logout", RoleViewer, auth.logoutHandler)
	handle("GET /api/v1/auth/me", RoleViewer, meHandler)
	handle("GET /api/v1/tailscale", RoleAdmin, a.tailscaleStatus)
	handle("POST /api/v1/tailscale", RoleAdmin, a.tailscaleAction(auth, audit))
	handle("GET /api/v1/terminal/passwords/{target}", RoleAdmin, auth.terminalPasswordHandler("status"))
	handle("POST /api/v1/terminal/passwords/{target}", RoleAdmin, auth.terminalPasswordHandler("save"))
	handle("POST /api/v1/terminal/passwords/{target}/reveal", RoleAdmin, auth.terminalPasswordHandler("reveal"))
	handle("DELETE /api/v1/terminal/passwords/{target}", RoleAdmin, auth.terminalPasswordHandler("delete"))
	handle("GET /api/v1/users", RoleAdmin, auth.usersHandler)
	handle("POST /api/v1/users", RoleAdmin, auth.createUserHandler)

	handle("GET /api/v1/host", RoleViewer, a.host)
	handle("GET /api/v1/host/power", RoleAdmin, a.powerStatus)
	handle("POST /api/v1/host/power", RoleAdmin, a.powerAction(auth, audit))
	handle("GET /api/v1/kubernetes/clusters", RoleViewer, kubeBounded(a.kubeClusters))
	handle("POST /api/v1/kubernetes/clusters", RoleAdmin, kubeBounded(a.kubeConnect))
	handle("DELETE /api/v1/kubernetes/clusters/{cluster}", RoleAdmin, kubeBounded(a.kubeDisconnect))
	handle("GET /api/v1/kubernetes/{cluster}/snapshot", RoleViewer, kubeBounded(a.kubeSnapshot))
	handle("GET /api/v1/kubernetes/{cluster}/resources/{kind}/{namespace}/{name}", RoleViewer, kubeBounded(a.kubeDetail))
	handle("GET /api/v1/kubernetes/{cluster}/resources/{kind}/{namespace}/{name}/yaml", RoleOperator, kubeBounded(a.kubeYAML))
	handle("GET /api/v1/kubernetes/{cluster}/resources/pods/{namespace}/{name}/logs", RoleOperator, kubeBounded(a.kubeLogs))
	handle("POST /api/v1/kubernetes/{cluster}/deployments/{namespace}/{name}/{action}", RoleOperator, kubeBounded(a.kubeAction))
	handle("GET /api/v1/containers", RoleViewer, containerHTTP.List)
	handle("POST /api/v1/containers", RoleAdmin, a.createContainer)
	handle("GET /api/v1/compose", RoleAdmin, a.composeCapabilities)
	handle("POST /api/v1/compose/validate", RoleAdmin, a.validateCompose)
	handle("POST /api/v1/compose/projects", RoleAdmin, a.createCompose)
	handle("DELETE /api/v1/containers/{id}", RoleAdmin, a.deleteContainer)
	handle("GET /api/v1/containers/{id}", RoleOperator, containerHTTP.Inspect)
	handle("GET /api/v1/containers/{id}/logs", RoleOperator, a.containerLogs)
	handle("POST /api/v1/containers/{id}/start", RoleOperator, containerHTTP.Action(containers.Start))
	handle("POST /api/v1/containers/{id}/stop", RoleOperator, containerHTTP.Action(containers.Stop))
	handle("POST /api/v1/containers/{id}/restart", RoleOperator, containerHTTP.Action(containers.Restart))
	handle("GET /api/v1/applications", RoleViewer, a.listApplications)
	handle("POST /api/v1/applications/{id}/{action}", RoleOperator, a.applicationAction)
	handle("GET /api/v1/virtual-machines", RoleViewer, a.listVirtualMachines)
	handle("POST /api/v1/virtual-machines/{name}/{action}", RoleOperator, a.virtualMachineAction)
	handle("GET /api/v1/services", RoleViewer, a.listServices)
	handle("POST /api/v1/services/{name}/start", RoleOperator, a.serviceAction(auth, audit, "start"))
	handle("POST /api/v1/services/{name}/stop", RoleOperator, a.serviceAction(auth, audit, "stop"))
	handle("POST /api/v1/services/{name}/restart", RoleOperator, a.serviceAction(auth, audit, "restart"))
	handle("GET /api/v1/storage", RoleViewer, a.storage)
	handle("GET /api/v1/files", RoleAdmin, a.files.list)
	handle("GET /api/v1/files/preview", RoleAdmin, a.files.preview(auth.dir))
	handle("DELETE /api/v1/files", RoleAdmin, a.files.remove(auth.dir))
	handle("POST /api/v1/files/upload", RoleAdmin, a.files.upload)
	handle("POST /api/v1/files/download-ticket", RoleAdmin, a.files.downloadTicket)
	// This endpoint consumes a one-use capability minted by an authenticated admin.
	mux.HandleFunc("GET /api/v1/files/download", a.files.download(auth))
	handle("GET /api/v1/network", RoleViewer, a.network)
	handle("GET /api/v1/monitoring", RoleViewer, a.monitoring)
	handle("GET /api/v1/observability/integrations", RoleViewer, obsBounded(a.obsIntegrations))
	handle("GET /api/v1/observability/summary", RoleViewer, obsBounded(a.obsSummary))
	handle("GET /api/v1/observability/targets", RoleViewer, obsBounded(a.obsTargets))
	handle("GET /api/v1/observability/rules", RoleViewer, obsBounded(a.obsRules))
	handle("GET /api/v1/observability/series", RoleViewer, obsBounded(a.obsSeries))
	handle("GET /api/v1/observability/resources/{id}", RoleViewer, obsBounded(a.obsResource))
	handle("GET /api/v1/observability/grafana-link", RoleViewer, obsBounded(a.obsGrafana))
	handle("GET /api/v1/monitoring/history", RoleViewer, a.monitoringHistory)
	handle("GET /api/v1/logs", RoleOperator, a.logs)
	handle("GET /api/v1/logs/sources", RoleOperator, a.logSources)
	handle("POST /api/v1/terminal/exec", RoleAdmin, a.terminalExec)
	handle("POST /api/v1/terminal/complete", RoleAdmin, a.terminalComplete)
	// WebSockets authenticate in their first frame, never in the URL.
	mux.HandleFunc("GET /api/v1/terminal/session", a.terminals.serveHTTP)
	mux.HandleFunc("GET /api/v1/containers/{id}/terminal", a.terminals.serveHTTP)
	handle("GET /api/v1/security", RoleOperator, a.security)
	handle("GET /api/v1/security/posture", RoleOperator, securityEvidence(a.securityPosture))
	handle("GET /api/v1/security/ssh-policy", RoleOperator, securityEvidence(a.securitySSHPolicy))
	handle("GET /api/v1/security/events", RoleOperator, securityEvidence(a.securityEvents))
	handle("GET /api/v1/security/scans/capabilities", RoleOperator, securityEvidence(a.securityScanCapabilities))
	handle("GET /api/v1/security/scans", RoleOperator, a.securityScanJobs)
	handle("POST /api/v1/security/scans", RoleAdmin, a.startSecurityScan(auth, audit))
	handle("GET /api/v1/security/monitor", RoleOperator, a.securityMonitorStatus)
	handle("POST /api/v1/security/monitor/reset", RoleAdmin, a.resetSecurityMonitor(auth, audit))
	handle("POST /api/v1/security/sessions/{pid}/terminate", RoleAdmin, a.terminateSecuritySession(auth, audit))
	handle("POST /api/v1/security/fix/{item}", RoleAdmin, a.fixSecurity(auth, audit))
	handle("GET /api/v1/updates", RoleViewer, a.updates)
	handle("GET /api/v1/updates/jobs/{id}", RoleAdmin, a.updateJob)
	handle("POST /api/v1/updates/refresh", RoleAdmin, a.refreshUpdates)
	handle("POST /api/v1/updates/apply", RoleAdmin, a.applyUpdates)
	handle("GET /api/v1/audit", RoleAdmin, audit.handler)
	handle("GET /api/v1/audit/integrity", RoleAdmin, audit.integrityHandler)
	return a.telemetry.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/security" || strings.HasPrefix(r.URL.Path, "/api/v1/security/") {
			w.Header().Set("Cache-Control", "no-store, private")
			w.Header().Set("Pragma", "no-cache")
		}
		mux.ServeHTTP(w, r)
	}))
}
