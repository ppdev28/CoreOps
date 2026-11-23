package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/moby/moby/client"
	dockeradapter "github.com/ppdev28/CoreOps/backend/internal/adapters/docker"
	"github.com/ppdev28/CoreOps/backend/internal/adapters/helperpath"
	"github.com/ppdev28/CoreOps/backend/internal/adapters/linuxsecurity"
	"github.com/ppdev28/CoreOps/backend/internal/adapters/securityscan"
	"github.com/ppdev28/CoreOps/backend/internal/adapters/sysstat"
	"github.com/ppdev28/CoreOps/backend/internal/containers"
	"github.com/ppdev28/CoreOps/backend/internal/hostpower"
	"github.com/ppdev28/CoreOps/backend/internal/monitoring"
	"github.com/ppdev28/CoreOps/backend/internal/observability"
	"github.com/ppdev28/CoreOps/backend/internal/security"
	"github.com/ppdev28/CoreOps/backend/internal/tailscale"
	"github.com/ppdev28/CoreOps/backend/internal/telemetry"
)

var buildVersion = "dev"
var buildCommit = "unknown"

type API struct {
	serviceControl  serviceController
	serviceMutation sync.Mutex
	tailscale       *tailscale.Service
	power           *hostpower.Service
	hostSecurity    *security.Service
	securityMonitor *security.Monitor
	securityScans   *security.ScanJobs
	updateTasks     *updateJobs
	observability   *observability.Service
	telemetry       *telemetry.HTTP
	history         *monitoring.History
	containers      *containers.Service
	kube            *kubeManager
	compose         *composeManager
	logRoot         string
	auditLogPath    string
	docker          *client.Client
	terminals       *terminalServer
	files           *FileExplorer
}

func main() {
	if len(os.Args) == 2 && (os.Args[1] == "version" || os.Args[1] == "--version") {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"version": buildVersion, "commit": buildCommit, "helpers": helperpath.Directory})
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "user" {
		os.Exit(runUserCLI(os.Args[2:]))
	}
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
	dataDir := envString("COREOPS_DATA_DIR", "data")
	auth, err := NewAuthStore(dataDir, envDuration("COREOPS_SESSION_TTL", defaultSessionTTL))
	if err != nil {
		logger.Error("open auth store", "error", err)
		os.Exit(1)
	}
	bootstrapAdmin(auth, logger)
	uploadLimit, err := filesUploadLimit()
	if err != nil {
		logger.Error("configure file explorer", "error", err)
		os.Exit(1)
	}
	files, err := newFileExplorer(envString("COREOPS_FILES_ROOT", "/"), uploadLimit, envDuration("COREOPS_FILES_TRANSFER_TIMEOUT", 30*time.Minute))
	if err != nil {
		logger.Error("open file explorer root", "error", err)
		os.Exit(1)
	}
	defer files.close()
	observabilityService, metricsToken, err := newObservability()
	if err != nil {
		logger.Error("configure observability", "error", err)
		os.Exit(1)
	}
	api := &API{containers: containers.New(dockeradapter.NewContainers(docker)), docker: docker, files: files, logRoot: envString("COREOPS_LOG_ROOT", "/var/log")}
	api.history = monitoring.NewHistory(sysstat.NewReader(envString("COREOPS_SYSSTAT_DIR", "/var/log/sysstat")))
	api.observability = observabilityService
	api.telemetry = telemetry.New(metricsToken)
	securitySource := linuxsecurity.New()
	api.hostSecurity = security.New(securitySource)
	api.securityMonitor = security.NewMonitor(securitySource, linuxsecurity.CheckpointFile{Dir: dataDir})
	go api.securityMonitor.Run(ctx)
	api.securityScans = security.NewScanJobs(ctx, &securityscan.Trivy{Binary: envString("COREOPS_TRIVY_PATH", ""), Cache: envString("COREOPS_TRIVY_CACHE", filepath.Join(dataDir, "trivy-cache")), Docker: docker})
	audit := NewAuditLog(dataDir)
	web, closeWeb, err := withWeb(api.routes(auth, audit), envString("COREOPS_WEB_DIR", ""))
	if err != nil {
		logger.Error("configure web assets", "error", err)
		os.Exit(1)
	}
	defer closeWeb()
	handler := withCORS(withLogging(withAudit(audit, web)))
	host := envString("COREOPS_HOST", "127.0.0.1")
	port := envInt("COREOPS_PORT", 8082)
	server := &http.Server{Addr: net.JoinHostPort(host, strconv.Itoa(port)), Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 40 * time.Second, WriteTimeout: 45 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		api.terminals.Close()
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
