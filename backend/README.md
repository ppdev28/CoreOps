# CoreOps backend

The backend is a small Go HTTP API that exposes CoreOps capabilities without leaking Docker Engine details into the frontend.

## Local development

The API uses Docker's standard environment configuration. On a Linux host with Docker installed directly, the Docker Unix socket is used automatically by the Docker SDK.

```bash
cd backend
go test ./...
go run ./cmd/coreops-api
```

The default API address is `http://localhost:8082`.

Useful endpoints:

- `GET /api/v1/health`
- `GET /api/v1/containers`
- `GET /api/v1/containers/:id`
- `POST /api/v1/containers/:id/start`
- `POST /api/v1/containers/:id/stop`
- `POST /api/v1/containers/:id/restart`

Set `COREOPS_PORT` to change the HTTP port, `COREOPS_HOST` to change the bind address (default `127.0.0.1`; use `0.0.0.0` or a Tailscale IP to reach it from other devices) and `COREOPS_CORS_ORIGINS` (comma-separated) to allow extra browser origins. The legacy `CoreOps_*` names still work.

## Authentication and roles

Every endpoint except `GET /api/v1/health` and `POST /api/v1/auth/login` requires a session token sent as `Authorization: Bearer <token>`. The interactive terminal WebSocket authenticates its first JSON frame instead, before starting any process; it never accepts a token in its URL.

Create the first user before starting the server. CLI and server must use the same service account and `COREOPS_DATA_DIR`. Updated binaries coordinate through `.identity.lock` and reload users/sessions on every operation, so password changes and removals revoke sessions without restarting. Stop all older API/CLI binaries before upgrading; mixed versions do not share this locking protocol. Existing JSON files and token hashes keep their format.

```bash
printf '%s' "a-long-password" | go run ./cmd/coreops-api user add alice admin
# or, on first start only:
COREOPS_ADMIN_USER=alice COREOPS_ADMIN_PASSWORD=a-long-password go run ./cmd/coreops-api
```

Other commands: `user passwd <name>` (removes sessions from the CLI store; the live server must be restarted as described above), `user remove <name>`, `user list`. Passwords need at least 10 characters and are stored as PBKDF2-SHA256 hashes.

| Role | Can do |
| --- | --- |
| `viewer` | read-only overviews (host, containers list, services, storage, network, monitoring, updates) |
| `operator` | viewer + container/application/VM/service actions, container detail (env vars), logs, security overview |
| `admin` | operator + terminal, security changes, package updates, audit log |

Login is rate limited (5 failures per client and user lock that pair for 15 minutes). Sessions last 12 hours (`COREOPS_SESSION_TTL`, e.g. `8h`).

State lives in `COREOPS_DATA_DIR` (default `./data`, files are `0600`): `users.json`, `sessions.json` (token hashes only) and `audit.log`.

`audit.log` is append-only JSON lines recording every non-GET request (including rejected ones and logins) with user, role, path, status, remote address and operation details. Terminal content/commands are redacted; PTY open/close and authentication denial are recorded explicitly despite using GET. Admins can read it with `GET /api/v1/audit?limit=200`.

The server does not terminate TLS. Put it behind Tailscale Serve or a reverse proxy with HTTPS before using it over a network you do not trust, because the token travels in a header.

## Security

The backend is intentionally designed to talk to Docker through the local Unix socket rather than exposing Docker Engine's TCP API. Access to the Docker socket is highly privileged and must be protected at the host level.

For the first integration, CoreOps is expected to run on the same Ubuntu host as Docker and be reachable remotely through the user's private network (for example Tailscale). Authentication and authorization already exist. Remaining security risks are tracked in [security review](../docs/security.md); Tailscale does not replace them.

See [backend module instructions](../docs/modules/backend.md), [API instructions](../docs/modules/api.md) and [identity/audit instructions](../docs/modules/identity-audit.md) before refactoring. Containers now has real internal capability, Docker adapter and HTTP transport packages. Other capabilities remain in the executable package; see [architecture](../docs/architecture.md).

## Interactive terminal

Container detail and context-menu Terminal use admin-only
`GET /api/v1/containers/{id}/terminal` with the same protocol and shared limits.
The adapter starts `/bin/sh -i` inside a running, unpaused container using its
configured user. Closing disconnects the attachment; use `exit` to end the shell.
Docker exec processes may continue after disconnect. No container stop or host
PID signals are used to clean up an attachment. [Container terminal](../docs/modules/terminal.md).

`GET /api/v1/terminal/session` upgrades to WebSocket, authenticates an admin in the first frame and starts a real PTY. The shell runs as the API service account, default `/bin/bash -l` in its home directory; set `COREOPS_TERMINAL_SHELL` to an absolute compatible shell path. It is host access with that account’s existing rights.

Configure the exact external origin with `COREOPS_CORS_ORIGINS` when using HTTPS termination or a separate frontend. The proxy must forward WebSocket upgrades and allow long connections. Active sessions revalidate authentication every second and close on logout/expiry/shutdown. Limits: four PTYs per admin, 32 total connections, 32 KiB input frames and 64 KiB unacknowledged output. No automatic resume/replay; internal navigation preserves open shells. Existing `/terminal/exec` and `/terminal/complete` remain for compatibility.

See [terminal protocol, proxy example and validation](../docs/modules/terminal.md). Use `go test -race ./...` to exercise real PTYs, roles/origins, state, resize, signals, hidden input, expiry/logout, flow control and shutdown.

## File explorer

Click a regular file's name to open the read-only viewer. Authenticated admin
`GET /api/v1/files/preview?path=…&version=…` returns bounded UTF-8 text or raster
image data as JSON, with explicit binary/size fallback and changed-file conflicts.
Preview reads are audited without content. [Viewer contract](../docs/modules/files.md).

The **Files** screen in the web sidebar, command palette and Android drawer browses the actual host filesystem. All listing, upload and ticket endpoints require `admin`. File access uses the API service's OS identity; it does not use sudo or bypass Unix permissions or systemd sandboxing.

| Variable | Default | Meaning |
| --- | --- | --- |
| `COREOPS_FILES_ROOT` | `/` | Existing server directory exposed as the explorer's logical `/` |
| `COREOPS_FILES_MAX_UPLOAD_BYTES` | `10737418240` | Maximum size of each upload (10 GiB) |
| `COREOPS_FILES_TRANSFER_TIMEOUT` | `30m` | Deadline for each upload or download; overrides the normal HTTP timeouts only for transfers |

For example, to restrict browsing to your downloads:

```bash
COREOPS_FILES_ROOT=/home/pepe/Downloads go run ./cmd/coreops-api
```

With systemd, put these variables in the existing `/etc/coreops/coreops.env` and restart the service after rebuilding. `deploy/coreops.service` has `ProtectHome=true`: home folders are inaccessible under that unit. Use an explicitly shared directory such as `/srv/coreops-files`, or a narrow systemd bind mount to the desired directory, and grant the service account the necessary directory traversal/read/write permissions. A missing or inaccessible configured root stops startup with a configuration error.

Endpoints:

- `GET /api/v1/files?path=/&q=&hidden=false&sort=name&order=asc&offset=0&limit=100` — directories first, metadata, filtering and pagination (maximum page size 200). Paths are relative to the configured root. Search applies to the current directory, including entries on other pages. Directories above 50,000 entries return a clear error instead of unbounded scans.
- `POST /api/v1/files/upload?path=/Documents&name=example.pdf` — raw file body, authenticated with the usual bearer header. Each file is streamed to a temporary file with mode `0600`, then published atomically with a no-replace hard link. This requires a filesystem supporting hard links (for example ext4). Existing names, including symlinks, return `409`; failed/oversized/interrupted requests remove temporary files. Temporary names are hidden and inaccessible through the explorer. A process crash can leave hidden `.coreops-upload-*` files; they may be removed once no transfers are active.
- `POST /api/v1/files/download-ticket` with JSON `{ "path": "/Documents/example.pdf" }` — opens a regular file and returns a one-use capability valid for five minutes. At most 128 pending capabilities are kept, with automatic expiry/descriptor cleanup.
- `GET /api/v1/files/download?ticket=...` — consumes that capability and checks the originating session is still valid and administrative. Streams an attachment directly to the browser or native save handler; no session token is put in a URL. A retry needs a new ticket. Links are short lived and are not share links.

Listings and downloads are audited as sensitive reads, in addition to uploads. Invalid paths and attempts to escape the root, including symlink races, are rejected using Go's descriptor-based `os.Root`. The UI labels symbolic links and special files as unavailable. Downloads reject directories, devices and FIFOs. The server root can include bind mounts; this is an OS access boundary, not a container sandbox.

Desktop supports file drag and drop. Mobile uses the system file picker; both support batches of up to 100 files with sequential uploads, progress, cancellation and per-file results. Uploads continue while moving between CoreOps screens; leaving/reloading the app interrupts them. Android downloads use `ACTION_CREATE_DOCUMENT` and a background streaming copy, without broad storage permissions. Rebuild the Android application after `pnpm build && pnpm cap:sync`; web assets alone do not install the new native plugin. iOS native downloads have not been validated; mobile Safari uses normal attachment downloads.

If using a reverse proxy, configure its maximum body size and transfer timeouts to match the API.


## Container creation

The Containers **Create container** button opens a responsive form. Only `admin` may call `POST /api/v1/containers`; viewer/operator cannot create containers. Existing list/detail/lifecycle routes keep their roles. The request uses CoreOps types, never raw Docker configuration:

```json
{
  "name": "web-service",
  "image": "nginx:stable-alpine",
  "environment": ["TZ=Europe/Madrid"],
  "command": [],
  "ports": [{"hostIp": "127.0.0.1", "hostPort": 18080, "containerPort": 80, "protocol": "tcp"}],
  "restartPolicy": "no",
  "start": false
}
```

Images must already exist on the Docker host: this slice does not pull images or store registry credentials. Omitted command uses the image's defaults/entrypoint. Restart policies: `no` (default), `unless-stopped`, `on-failure`, `always`. Default network is bridge; only explicit mappings publish ports, defaulting to loopback. Set a server interface IP or explicitly `0.0.0.0` when remote access is intended. There are no host mounts, host namespaces or privileged options in this contract. Image-defined anonymous volumes and Docker defaults still apply.

Maximum body: 64 KiB; name: 1–128 characters; 100 unique `NAME=value` environment variables, 64 command arguments, 32 TCP/UDP port mappings. Each environment entry/argument is limited to 4096 bytes; ports are 1–65535. Unknown fields and trailing JSON are rejected. Operations use a 30 s deadline and never retry automatically.

Success returns HTTP 201 with `{ "id": "…", "name": "…", "started": false, "warnings": [] }` and `Location`. `start=true` performs a separate start after creation. If start fails, creation still returns 201 with the ID and `startError`; inspect the existing container before starting it again. `started=true` means Docker accepted the start request, not that the workload remains running. Name conflicts return 409; missing local image returns 422. An interrupted request can have created a container: refresh the list before retrying. Audit records name/ID and start outcome, excluding environment values and command arguments.


## Container deletion

The Containers action menu **Delete** now calls `DELETE /api/v1/containers/{id}` instead of displaying a simulated success. Only `admin` may delete. The UI always asks for confirmation, including when optional destructive confirmations are disabled. Stop the container before deleting; the backend calls Docker without force, so a concurrent start is also rejected rather than killed.

No query options or request body are accepted. `Force`, `RemoveVolumes` and `RemoveLinks` are always false. Container writable-layer data is removed; named/anonymous volumes, bind-mount data and images are preserved. The operation has a 30 s deadline, is audited and never retries automatically.

Success: HTTP 200 `{ "ok": true, "id": "…" }`. Invalid ID/options/body return 400, insufficient role 403, missing container 404, running/current-state conflict 409, other Docker failures 502. If the request fails or is interrupted, refresh the list before retrying. UI pending state blocks duplicate/concurrent mutations and navigation into a disappearing container; only a validated success removes its row/selection and refreshes inventory. Errors remain visible even with notifications disabled.


## Log explorer

The Dozzle-inspired CoreOps reader uses the existing operator/admin permission for logs. `GET /api/v1/logs` remains compatible; `?source=system` restricts reading to journal. `GET /api/v1/containers/{id}/logs?tail=500` reads one container (tail 1–1000). These are bounded JSON snapshots with no-store and explicit errors/warnings. Automatic updates poll after 2 s, can be paused and never alter host logs.

Docker stdout/stderr and TTY output retain real timestamps and whitespace; missing timestamps are empty. Journal uses JSON timestamps/priorities. Limits: 2 MiB per read, 64 KiB per line, 1000 container lines; aggregate keeps 500 records with up to four concurrent Docker reads. Container deadline: 10 s; aggregate: 12 s. Snapshots add optional `stream`, `warnings` and `truncated` metadata. Downloads/copy contain the displayed filtered buffer, not the complete historical log. See [Logs guide](../docs/modules/logs.md) for data contract, roles, UI and validation.

### Host log history and events

Logs now exposes the retained journal across boots (`category=all|kernel|services|security`, optional exact `unit`, RFC3339 `since`/`until`), paged plain/rotated/gzip host files, and the daemon's retained Docker event buffer. New operator/admin catalog: `GET /api/v1/logs/sources`; readers: `/logs?source=system`, `/logs?source=file&file=syslog`, `/logs?source=events`. Journal/files accept `limit=1..1000` and the returned `nextCursor`. The existing aggregate remains a recent journal/container snapshot.

`COREOPS_LOG_ROOT` defaults to `/var/log`. Reads are descriptor confined, regular text logs only, without symlinks/FIFO or new host privileges. Journal access and file permissions belong to the service account; grant only necessary read ACLs/groups and restart after membership changes. CoreOps audit remains admin-only and is excluded from the file reader even if deployed under the log root. See [full contract, coverage and limits](../docs/modules/logs.md). Older gzip pages replay decompression under a deadline; Docker event retention is finite, not a durable new archive.

## Docker Compose creation

Admin-only `GET /api/v1/compose`, `POST /api/v1/compose/validate`, `POST /api/v1/compose/projects` support the Compose tab in Create container. Submit `{project,compose,start}` for preview, then include its `validationHash` when creating. Only new projects are supported, using local images, project bridge networks and named/anonymous volumes. No pulls/builds/host mounts/external files/resources or privileged configuration. Ports without an explicit IP bind to loopback; start defaults to false.

The server needs the installed Docker Compose CLI plugin (tested v5.7.0) and its existing Unix Docker endpoint. CLI and SDK use the same daemon. Manifests/reservations live privately under `COREOPS_DATA_DIR/compose`; relative data paths are normalized. 201 confirms creation/start request; 202 explicitly reports partial/uncertain results and keeps the project reserved. No destructive rollback or automatic retry. See [Compose guide](../docs/modules/compose.md) for supported fields, limits, persisted secrets, permissions, CLI isolation and recovery.

## Kubernetes

La pantalla Kubernetes conecta desde el backend con API servers HTTPS existentes. Configuración admin mediante `/api/v1/kubernetes/clusters`, perfiles privados bajo `COREOPS_DATA_DIR/kubernetes`, namespace scope y RBAC upstream. Viewer consulta inventario/eventos; operator accede a logs/YAML y escala/reinicia Deployments; admin configura conexiones. No requiere kubectl. El soporte inicial no incluye pods/exec, rollback, historial de métricas ni gestión de red/configuración/storage.

Consultar [guía Kubernetes](../docs/modules/kubernetes.md) para configuración, permisos, rutas, límites, semántica de aceptación/recuperación y pruebas. No guardar tokens/kubeconfigs en el repositorio ni dar cluster-admin para ocultar fallos de permisos.

## Modules and contract

`internal/containers` owns the container use cases and Runtime port; `internal/adapters/docker` implements it; `internal/transport/httpapi` owns container HTTP/DTOs and common JSON helpers. `main.go` wires them and `routes.go` preserves auth/roles/audit. The initial contract is [api/openapi.json](../api/openapi.json), validated in Go tests against real handlers and fake runtimes. The OpenAPI test dependency is not imported by the production binary. Identity persistence and other capabilities still await extraction; no new host privilege or endpoint is added.

Integration with the later slices preserves admin-only creation/deletion/Compose, bounded operator logs, Files, Kubernetes and identity reload/revocation. Create/delete handlers are not yet extracted backend use cases; the OpenAPI contract remains partial. All web clients use the same extracted session/transport through compatibility facades.


## Recorded host metrics

`GET /api/v1/monitoring/history?range=24h` (viewer) returns retained host CPU/memory samples from existing sysstat archives. `sadf` and readable archives are required; `COREOPS_SYSSTAT_DIR` defaults to `/var/log/sysstat`. No collector is installed or enabled. Dashboard/Monitoring merge this history with live snapshots and show unavailable coverage explicitly. [Contract, definitions and limits](../docs/modules/monitoring-history.md).

## Prometheus / Grafana observability

The read-only `/api/v1/observability/*` capability uses the existing viewer sessions.
`GET /metrics` uses a separate configured scrape token and is disabled when it is absent.
See [installation, environment variables, metrics/rules and diagnostics](../docs/observability.md)
and [validation evidence](../docs/observability-validation-2026-11-16.md).

## File deletion and tracked package updates

Admin-only DELETE `/api/v1/files` deletes a regular file after validating its
listing version; no directories, recursion, sudo or symlink targets. Existing
filesystem permissions apply. [Contract/limits](../docs/modules/files.md).

Package refresh/apply now return 202 jobs instead of waiting through the HTTP
write timeout. Admin polls `/api/v1/updates/jobs/{id}` or `/current`. The restricted
root-owned APT helper must be installed by a sudo-enabled operator; the current
service account has no passwordless sudo. [Installation](../docs/modules/updates.md).

### Host Security

`GET /api/v1/security` requires operator/admin. Independent source states distinguish missing tools and denied permissions from disabled controls. SSH rows include a stable ID, user/UID, terminal, PID/parent and available origin/login evidence. `POST /api/v1/security/sessions/{pid}/terminate` requires admin and exactly `{"id":"<session-id>"}`; fresh verified identity, trusted OpenSSH executables and OS signal permission are mandatory. It returns 202 `termination_requested`, not confirmed termination. The inventory confirms disappearance. There is no arbitrary PID kill or sudo signal fallback.

`POST /api/v1/security/fix/auto-updates` requires admin and verifies effective APT policy and `apt-daily-upgrade.timer` after enabling it. An unreadable policy or missing host permission prevents changes. The optional root-owned helper has fixed read-only operations; timer modification is a separate opt-in sudo rule. See [Security module](../docs/modules/host-security.md) before installing anything. No new host privilege is installed automatically.
