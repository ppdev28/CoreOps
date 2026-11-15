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

See [backend module instructions](../docs/modules/backend.md), [API instructions](../docs/modules/api.md) and [identity/audit instructions](../docs/modules/identity-audit.md) before refactoring. The proposed internal packages are not implemented yet.

## Interactive terminal

`GET /api/v1/terminal/session` upgrades to WebSocket, authenticates an admin in the first frame and starts a real PTY. The shell runs as the API service account, default `/bin/bash -l` in its home directory; set `COREOPS_TERMINAL_SHELL` to an absolute compatible shell path. It is host access with that account’s existing rights.

Configure the exact external origin with `COREOPS_CORS_ORIGINS` when using HTTPS termination or a separate frontend. The proxy must forward WebSocket upgrades and allow long connections. Active sessions revalidate authentication every second and close on logout/expiry/shutdown. Limits: four PTYs per admin, 32 total connections, 32 KiB input frames and 64 KiB unacknowledged output. No automatic resume/replay; internal navigation preserves open shells. Existing `/terminal/exec` and `/terminal/complete` remain for compatibility.

See [terminal protocol, proxy example and validation](../docs/modules/terminal.md). Use `go test -race ./...` to exercise real PTYs, roles/origins, state, resize, signals, hidden input, expiry/logout, flow control and shutdown.

## File explorer

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
