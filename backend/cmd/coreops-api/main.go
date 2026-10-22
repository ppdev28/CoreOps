package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/moby/moby/client"
)

type API struct{ docker *client.Client }

func main() {
	level := new(slog.LevelVar)
	level.Set(slog.LevelInfo)
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	docker, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		logger.Error("create docker client", "error", err)
		os.Exit(1)
	}
	defer docker.Close()
	api := &API{docker: docker}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", api.health)
	mux.HandleFunc("GET /api/v1/host", api.host)
	mux.HandleFunc("GET /api/v1/containers", api.listContainers)
	mux.HandleFunc("GET /api/v1/containers/{id}", api.getContainer)
	mux.HandleFunc("POST /api/v1/containers/{id}/start", api.startContainer)
	mux.HandleFunc("POST /api/v1/containers/{id}/stop", api.stopContainer)
	mux.HandleFunc("POST /api/v1/containers/{id}/restart", api.restartContainer)
	mux.HandleFunc("GET /api/v1/applications", api.listApplications)
	mux.HandleFunc("POST /api/v1/applications/{id}/{action}", api.applicationAction)
	mux.HandleFunc("GET /api/v1/virtual-machines", api.listVirtualMachines)
	mux.HandleFunc("POST /api/v1/virtual-machines/{name}/{action}", api.virtualMachineAction)
	mux.HandleFunc("GET /api/v1/services", api.listServices)
	mux.HandleFunc("POST /api/v1/services/{name}/start", api.startService)
	mux.HandleFunc("POST /api/v1/services/{name}/stop", api.stopService)
	mux.HandleFunc("POST /api/v1/services/{name}/restart", api.restartService)
	mux.HandleFunc("GET /api/v1/storage", api.storage)
	mux.HandleFunc("GET /api/v1/network", api.network)
	mux.HandleFunc("GET /api/v1/monitoring", api.monitoring)
	mux.HandleFunc("GET /api/v1/logs", api.logs)
	mux.HandleFunc("POST /api/v1/terminal/exec", api.terminalExec)
	mux.HandleFunc("POST /api/v1/terminal/complete", api.terminalComplete)
	mux.HandleFunc("GET /api/v1/security", api.security)
	mux.HandleFunc("POST /api/v1/security/sessions/{pid}/terminate", api.terminateSecuritySession)
	mux.HandleFunc("POST /api/v1/security/fix/{item}", api.fixSecurity)
	mux.HandleFunc("GET /api/v1/updates", api.updates)
	mux.HandleFunc("POST /api/v1/updates/refresh", api.refreshUpdates)
	mux.HandleFunc("POST /api/v1/updates/apply", api.applyUpdates)
	host := envString("COREOPS_HOST", "127.0.0.1")
	port := envInt("COREOPS_PORT", 8082)
	server := &http.Server{Addr: net.JoinHostPort(host, strconv.Itoa(port)), Handler: withCORS(withLogging(mux)), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 40 * time.Second, WriteTimeout: 45 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	logger.Info("CoreOps API listening", "addr", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("HTTP server stopped", "error", err)
		os.Exit(1)
	}
}
