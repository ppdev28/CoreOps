package main

import "net/http"

// routes builds the API router. Every route except health and login requires
// a session whose role is at least the one declared here:
//
//	viewer   read-only overviews
//	operator container/service/VM actions and sensitive reads (logs, env vars)
//	admin    shell access, security changes, package updates, audit log
func (a *API) routes(auth *AuthStore, audit *AuditLog) http.Handler {
	mux := http.NewServeMux()
	handle := func(pattern string, min Role, h http.HandlerFunc) {
		mux.HandleFunc(pattern, auth.require(min, h))
	}

	mux.HandleFunc("GET /api/v1/health", a.health)
	mux.HandleFunc("POST /api/v1/auth/login", auth.loginHandler)
	handle("POST /api/v1/auth/logout", RoleViewer, auth.logoutHandler)
	handle("GET /api/v1/auth/me", RoleViewer, meHandler)

	handle("GET /api/v1/host", RoleViewer, a.host)
	handle("GET /api/v1/containers", RoleViewer, a.listContainers)
	handle("GET /api/v1/containers/{id}", RoleOperator, a.getContainer)
	handle("POST /api/v1/containers/{id}/start", RoleOperator, a.startContainer)
	handle("POST /api/v1/containers/{id}/stop", RoleOperator, a.stopContainer)
	handle("POST /api/v1/containers/{id}/restart", RoleOperator, a.restartContainer)
	handle("GET /api/v1/applications", RoleViewer, a.listApplications)
	handle("POST /api/v1/applications/{id}/{action}", RoleOperator, a.applicationAction)
	handle("GET /api/v1/virtual-machines", RoleViewer, a.listVirtualMachines)
	handle("POST /api/v1/virtual-machines/{name}/{action}", RoleOperator, a.virtualMachineAction)
	handle("GET /api/v1/services", RoleViewer, a.listServices)
	handle("POST /api/v1/services/{name}/start", RoleOperator, a.startService)
	handle("POST /api/v1/services/{name}/stop", RoleOperator, a.stopService)
	handle("POST /api/v1/services/{name}/restart", RoleOperator, a.restartService)
	handle("GET /api/v1/storage", RoleViewer, a.storage)
	handle("GET /api/v1/network", RoleViewer, a.network)
	handle("GET /api/v1/monitoring", RoleViewer, a.monitoring)
	handle("GET /api/v1/logs", RoleOperator, a.logs)
	handle("POST /api/v1/terminal/exec", RoleAdmin, a.terminalExec)
	handle("POST /api/v1/terminal/complete", RoleAdmin, a.terminalComplete)
	handle("GET /api/v1/security", RoleOperator, a.security)
	handle("POST /api/v1/security/sessions/{pid}/terminate", RoleAdmin, a.terminateSecuritySession)
	handle("POST /api/v1/security/fix/{item}", RoleAdmin, a.fixSecurity)
	handle("GET /api/v1/updates", RoleViewer, a.updates)
	handle("POST /api/v1/updates/refresh", RoleAdmin, a.refreshUpdates)
	handle("POST /api/v1/updates/apply", RoleAdmin, a.applyUpdates)
	handle("GET /api/v1/audit", RoleAdmin, audit.handler)
	return mux
}
