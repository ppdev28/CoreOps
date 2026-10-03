package main

import (
    "context"
    "encoding/json"
    "errors"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "regexp"
    "strconv"
    "strings"
    "syscall"
    "time"

    "github.com/containerd/errdefs"
    "github.com/moby/moby/api/types/container"
    "github.com/moby/moby/client"
)

type API struct { docker *client.Client }
type ContainerSummary struct { ID string `json:"id"`; Name string `json:"name"`; Image string `json:"image"`; State string `json:"state"`; Status string `json:"status"`; CreatedAt int64 `json:"createdAt"`; Ports []Port `json:"ports"`; Networks []string `json:"networks"` }
type Port struct { PrivatePort uint16 `json:"privatePort"`; PublicPort uint16 `json:"publicPort,omitempty"`; Type string `json:"type"`; IP string `json:"ip,omitempty"` }
type ErrorResponse struct { Error string `json:"error"` }
var containerIDPattern = regexp.MustCompile(`^[a-fA-F0-9]{12,64}$`)

func main() {
    level := new(slog.LevelVar); level.Set(slog.LevelInfo)
    logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level})); slog.SetDefault(logger)
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM); defer stop()
    docker, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation()); if err != nil { logger.Error("create docker client", "error", err); os.Exit(1) }; defer docker.Close()
    api := &API{docker: docker}; mux := http.NewServeMux()
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
    port := envInt("CoreOps_PORT", 8082)
    server := &http.Server{Addr: ":"+strconv.Itoa(port), Handler: withCORS(withLogging(mux)), ReadHeaderTimeout:5*time.Second, ReadTimeout:40*time.Second, WriteTimeout:45*time.Second, IdleTimeout:60*time.Second}
    go func(){ <-ctx.Done(); shutdownCtx,cancel:=context.WithTimeout(context.Background(),5*time.Second); defer cancel(); _=server.Shutdown(shutdownCtx) }()
    logger.Info("CoreOps API listening", "addr", server.Addr)
    if err:=server.ListenAndServe(); err!=nil && !errors.Is(err,http.ErrServerClosed){logger.Error("HTTP server stopped","error",err);os.Exit(1)}
}
func (a *API) health(w http.ResponseWriter,r *http.Request){ctx,cancel:=context.WithTimeout(r.Context(),3*time.Second);defer cancel();if _,err:=a.docker.Ping(ctx,client.PingOptions{});err!=nil{writeJSON(w,http.StatusServiceUnavailable,map[string]any{"status":"degraded","docker":"unavailable"});return};writeJSON(w,http.StatusOK,map[string]any{"status":"ok","docker":"available"})}
func (a *API) host(w http.ResponseWriter,r *http.Request){overview,err:=collectHostOverview();if err!=nil{writeError(w,http.StatusInternalServerError,err);return};writeJSON(w,http.StatusOK,overview)}
func (a *API) listApplications(w http.ResponseWriter,r *http.Request){applications,err:=collectApplications(r.Context(),a.docker);if err!=nil{writeError(w,http.StatusBadGateway,err);return};writeJSON(w,http.StatusOK,applications)}
func (a *API) applicationAction(w http.ResponseWriter,r *http.Request){id:=r.PathValue("id");action:=r.PathValue("action");if action!="start"&&action!="stop"&&action!="restart"{writeJSON(w,http.StatusBadRequest,ErrorResponse{Error:"invalid application action"});return};applications,err:=collectApplications(r.Context(),a.docker);if err!=nil{writeError(w,http.StatusBadGateway,err);return};var ids []string;for _,app:=range applications{if app.ID==id{ids=app.ContainerIDs;break}};if len(ids)==0{writeJSON(w,http.StatusNotFound,ErrorResponse{Error:"application not found"});return};if err:=applicationAction(r.Context(),a.docker,ids,action);err!=nil{writeError(w,http.StatusBadGateway,err);return};writeJSON(w,http.StatusOK,map[string]any{"ok":true,"id":id,"action":action})}
func (a *API) listVirtualMachines(w http.ResponseWriter,r *http.Request){machines,err:=collectVirtualMachines(r.Context());if err!=nil{writeError(w,http.StatusBadGateway,err);return};writeJSON(w,http.StatusOK,machines)}
func (a *API) virtualMachineAction(w http.ResponseWriter,r *http.Request){name:=r.PathValue("name");action:=r.PathValue("action");if action!="start"&&action!="shutdown"{writeJSON(w,http.StatusBadRequest,ErrorResponse{Error:"invalid virtual machine action"});return};if err:=virtualMachineAction(r.Context(),name,action);err!=nil{writeError(w,http.StatusBadGateway,err);return};writeJSON(w,http.StatusOK,VirtualMachineActionResponse{OK:true,Name:name,Action:action})}
func (a *API) listServices(w http.ResponseWriter,r *http.Request){services,err:=collectServices(r.Context());if err!=nil{writeError(w,http.StatusBadGateway,err);return};writeJSON(w,http.StatusOK,services)}
func (a *API) startService(w http.ResponseWriter,r *http.Request){a.serviceAction(w,r,"start")};func (a *API) stopService(w http.ResponseWriter,r *http.Request){a.serviceAction(w,r,"stop")};func (a *API) restartService(w http.ResponseWriter,r *http.Request){a.serviceAction(w,r,"restart")}
func (a *API) serviceAction(w http.ResponseWriter,r *http.Request,action string){name:=r.PathValue("name");if !systemdUnitPattern.MatchString(name){writeJSON(w,http.StatusBadRequest,ErrorResponse{Error:"invalid systemd service name"});return};if err:=serviceAction(r.Context(),name,action);err!=nil{writeError(w,http.StatusBadGateway,err);return};writeJSON(w,http.StatusOK,map[string]any{"ok":true,"name":name,"action":action})}
func (a *API) storage(w http.ResponseWriter,r *http.Request){overview,err:=collectStorage(r.Context(),a.docker);if err!=nil{writeError(w,http.StatusBadGateway,err);return};writeJSON(w,http.StatusOK,overview)}
func (a *API) network(w http.ResponseWriter,r *http.Request){ctx,cancel:=context.WithTimeout(r.Context(),8*time.Second);defer cancel();overview,err:=collectNetwork(ctx,a.docker);if err!=nil{writeError(w,http.StatusBadGateway,err);return};writeJSON(w,http.StatusOK,overview)}
func (a *API) monitoring(w http.ResponseWriter,r *http.Request){ctx,cancel:=context.WithTimeout(r.Context(),8*time.Second);defer cancel();overview,err:=collectMonitoring(ctx,a.docker);if err!=nil{writeError(w,http.StatusBadGateway,err);return};writeJSON(w,http.StatusOK,overview)}
func (a *API) logs(w http.ResponseWriter,r *http.Request){ctx,cancel:=context.WithTimeout(r.Context(),12*time.Second);defer cancel();overview,err:=collectLogs(ctx,a.docker);if err!=nil{writeError(w,http.StatusBadGateway,err);return};writeJSON(w,http.StatusOK,overview)}
func (a *API) terminalExec(w http.ResponseWriter,r *http.Request){var req TerminalExecRequest;if err:=json.NewDecoder(http.MaxBytesReader(w,r.Body,64*1024)).Decode(&req);err!=nil{writeJSON(w,http.StatusBadRequest,ErrorResponse{Error:"invalid terminal request"});return};if strings.TrimSpace(req.Command)==""{writeJSON(w,http.StatusBadRequest,ErrorResponse{Error:"command is required"});return};result,err:=executeTerminalCommand(r.Context(),req);if err!=nil{writeError(w,http.StatusInternalServerError,err);return};writeJSON(w,http.StatusOK,result)}
func (a *API) terminalComplete(w http.ResponseWriter,r *http.Request){var req TerminalCompleteRequest;if err:=json.NewDecoder(http.MaxBytesReader(w,r.Body,16*1024)).Decode(&req);err!=nil{writeJSON(w,http.StatusBadRequest,ErrorResponse{Error:"invalid terminal completion request"});return};result,err:=completeTerminalInput(r.Context(),req);if err!=nil{writeError(w,http.StatusBadGateway,err);return};writeJSON(w,http.StatusOK,result)}
func (a *API) listContainers(w http.ResponseWriter,r *http.Request){result,err:=a.docker.ContainerList(r.Context(),client.ContainerListOptions{All:true});if err!=nil{writeError(w,http.StatusBadGateway,err);return};containers:=result.Items;response:=make([]ContainerSummary,0,len(containers));for _,c:=range containers{response=append(response,summarizeContainer(c))};writeJSON(w,http.StatusOK,response)}
func (a *API) getContainer(w http.ResponseWriter,r *http.Request){id:=r.PathValue("id");result,err:=a.docker.ContainerInspect(r.Context(),id,client.ContainerInspectOptions{});if err!=nil{status:=http.StatusBadGateway;if errdefs.IsNotFound(err){status=http.StatusNotFound};writeError(w,status,err);return};c:=result.Container;response:=map[string]any{"id":c.ID,"name":strings.TrimPrefix(c.Name,"/"),"image":c.Config.Image,"state":c.State.Status,"created":c.Created,"config":map[string]any{"env":c.Config.Env,"cmd":c.Config.Cmd,"entrypoint":c.Config.Entrypoint,"workingDir":c.Config.WorkingDir},"restartPolicy":c.HostConfig.RestartPolicy.Name,"mounts":c.Mounts,"networks":c.NetworkSettings.Networks,"ports":c.NetworkSettings.Ports,"labels":c.Config.Labels};writeJSON(w,http.StatusOK,response)}
func (a *API) startContainer(w http.ResponseWriter,r *http.Request){a.containerAction(w,r,func(ctx context.Context,id string)error{_,err:=a.docker.ContainerStart(ctx,id,client.ContainerStartOptions{});return err})};func (a *API) stopContainer(w http.ResponseWriter,r *http.Request){a.containerAction(w,r,func(ctx context.Context,id string)error{_,err:=a.docker.ContainerStop(ctx,id,client.ContainerStopOptions{});return err})};func (a *API) restartContainer(w http.ResponseWriter,r *http.Request){a.containerAction(w,r,func(ctx context.Context,id string)error{_,err:=a.docker.ContainerRestart(ctx,id,client.ContainerRestartOptions{});return err})}
func (a *API) containerAction(w http.ResponseWriter,r *http.Request,action func(context.Context,string)error){id:=r.PathValue("id");if !containerIDPattern.MatchString(id){writeJSON(w,http.StatusBadRequest,ErrorResponse{Error:"invalid container ID"});return};if err:=action(r.Context(),id);err!=nil{status:=http.StatusBadGateway;if errdefs.IsNotFound(err){status=http.StatusNotFound};writeError(w,status,err);return};writeJSON(w,http.StatusOK,map[string]any{"ok":true,"id":id})}
func summarizeContainer(c container.Summary)ContainerSummary{ports:=make([]Port,0,len(c.Ports));for _,p:=range c.Ports{ports=append(ports,Port{PrivatePort:p.PrivatePort,PublicPort:p.PublicPort,Type:p.Type,IP:p.IP.String()})};networks:=make([]string,0,len(c.NetworkSettings.Networks));for name:=range c.NetworkSettings.Networks{networks=append(networks,name)};name:="";if len(c.Names)>0{name=strings.TrimPrefix(c.Names[0],"/")};return ContainerSummary{ID:c.ID,Name:name,Image:c.Image,State:string(c.State),Status:c.Status,CreatedAt:c.Created,Ports:ports,Networks:networks}}
func writeJSON(w http.ResponseWriter,status int,value any){w.Header().Set("Content-Type","application/json");w.WriteHeader(status);_=json.NewEncoder(w).Encode(value)};func writeError(w http.ResponseWriter,status int,err error){writeJSON(w,status,ErrorResponse{Error:err.Error()})};func withCORS(next http.Handler)http.Handler {
	allowedOrigins := map[string]struct{}{
		"http://localhost:5173": {},
		"https://localhost":     {},
		"http://localhost":      {},
		"capacitor://localhost": {},
	}
	if extra := os.Getenv("CoreOps_CORS_ORIGINS"); extra != "" {
		for _, origin := range strings.Split(extra, ",") {
			origin = strings.TrimSpace(origin)
			if origin != "" {
				allowedOrigins[origin] = struct{}{}
			}
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if _, ok := allowedOrigins[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
};func withLogging(next http.Handler)http.Handler{return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){start:=time.Now();next.ServeHTTP(w,r);slog.Info("http request","method",r.Method,"path",r.URL.Path,"duration",time.Since(start).String())})};func envInt(name string,fallback int)int{value:=os.Getenv(name);if value==""{return fallback};parsed,err:=strconv.Atoi(value);if err!=nil||parsed<1||parsed>65535{return fallback};return parsed}