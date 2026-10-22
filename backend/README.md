# CoreOps backend

The backend is a small Go HTTP API that exposes CoreOps capabilities without leaking Docker Engine details into the frontend.

## Local development

The API uses Docker's standard environment configuration. On a Linux host with Docker installed directly, the Docker Unix socket is used automatically by the Docker SDK.

```bash
cd backend
go mod tidy
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

Every endpoint except `GET /api/v1/health` and `POST /api/v1/auth/login` requires a session token sent as `Authorization: Bearer <token>`.

Create the first user before (or while) starting the server:

```bash
printf '%s' "a-long-password" | go run ./cmd/coreops-api user add alice admin
# or, on first start only:
COREOPS_ADMIN_USER=alice COREOPS_ADMIN_PASSWORD=a-long-password go run ./cmd/coreops-api
```

Other commands: `user passwd <name>` (revokes that user's sessions), `user remove <name>`, `user list`. Passwords need at least 10 characters and are stored as PBKDF2-SHA256 hashes.

| Role | Can do |
| --- | --- |
| `viewer` | read-only overviews (host, containers list, services, storage, network, monitoring, updates) |
| `operator` | viewer + container/application/VM/service actions, container detail (env vars), logs, security overview |
| `admin` | operator + terminal, security changes, package updates, audit log |

Login is rate limited (5 failures per client and user lock that pair for 15 minutes). Sessions last 12 hours (`COREOPS_SESSION_TTL`, e.g. `8h`).

State lives in `COREOPS_DATA_DIR` (default `./data`, files are `0600`): `users.json`, `sessions.json` (token hashes only) and `audit.log`.

`audit.log` is append-only JSON lines recording every non-GET request (including rejected ones and logins) with user, role, path, status, remote address and, for the terminal, the command. Admins can read it with `GET /api/v1/audit?limit=200`.

The server does not terminate TLS. Put it behind Tailscale Serve or a reverse proxy with HTTPS before using it over a network you do not trust, because the token travels in a header.

## Security

The backend is intentionally designed to talk to Docker through the local Unix socket rather than exposing Docker Engine's TCP API. Access to the Docker socket is highly privileged and must be protected at the host level.

For the first integration, CoreOps is expected to run on the same Ubuntu host as Docker and be reachable remotely through the user's private network (for example Tailscale). Authentication and authorization will be added before CoreOps is exposed beyond a trusted development network.
