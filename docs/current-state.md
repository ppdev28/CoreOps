# Current State

Last known working milestone: **the Figma-designed Containers UI displays real Docker data and performs tested start, stop and restart operations against the Ubuntu Server Docker Engine**.

## Repository

- GitHub repository: `ppdev28/CoreOps`
- Active branch: `feature/project-foundation`
- The developer also has a local checkout on the Ubuntu server at `~/proyectos/CoreOps`.
- GitHub authentication from the server uses SSH.
- The JavaScript package manager is pnpm.

## Frontend

Stack:

- React
- TypeScript
- Vite
- Tailwind CSS
- Lucide
- Recharts
- pnpm

The frontend lives in `frontend/`.

The UI originated in Figma Make and has been brought into the repository. It contains route-level views, reusable components, shared types, UI data and utility code.

The Containers screen has been connected to the CoreOps API rather than relying on its original mock container list. All Figma-era mock data has been removed: container detail now always uses the real inspect endpoint, the notifications menu is empty until alerting exists, the header/terminal hostname and user come from the server, and the "Available apps" catalog was dropped because installing apps is not implemented.

The Vite development server proxies `/api` requests to the local backend on port `8082`.

The app shows a login screen until a session exists (`lib/auth.ts`, `views/LoginView.tsx`). `lib/api.ts` attaches the token to every request and returns to the login screen on a 401. The session is kept in `localStorage`.

Known frontend validation command:

```bash
cd ~/proyectos/CoreOps/frontend
pnpm install
pnpm build
pnpm dev --host 0.0.0.0
```

The build currently succeeds. Vite may report a chunk-size warning for the main JavaScript bundle; this is not currently a release blocker.

## Backend

Stack: Go (stdlib `net/http`), Moby Docker client, no database (JSON files under `COREOPS_DATA_DIR`).

The backend lives in `backend/cmd/coreops-api` and listens on `127.0.0.1:8082` by default (`COREOPS_HOST`, `COREOPS_PORT`). See `backend/README.md` for configuration.

Source layout: `main.go` (startup), `routes.go` (route table with minimum role per endpoint), `http.go` (JSON helpers, CORS, logging, env), `auth.go` (users, sessions, roles), `audit.go` (audit log), `users_cli.go` (`coreops-api user ...`), `containers.go` and one file per area (`host`, `services`, `storage`, `network`, `monitoring`, `logs`, `security`, `updates`, `applications`, `virtual_machines`, `terminal`).

Implemented endpoints (all require a session except health and login):

```text
GET  /api/v1/health                              public
POST /api/v1/auth/login | logout, GET /auth/me
GET  /api/v1/host | storage | network | monitoring | updates
GET  /api/v1/containers, GET /containers/{id}
POST /api/v1/containers/{id}/start|stop|restart
GET  /api/v1/applications, POST /applications/{id}/{action}
GET  /api/v1/virtual-machines, POST /virtual-machines/{name}/{action}
GET  /api/v1/services, POST /services/{name}/start|stop|restart
GET  /api/v1/logs, GET /security
POST /api/v1/terminal/exec | complete             admin
POST /api/v1/security/sessions/{pid}/terminate, /security/fix/{item}   admin
POST /api/v1/updates/refresh | apply              admin
GET  /api/v1/audit                                admin
```

### Security model

- Opaque session tokens (`Authorization: Bearer`), stored server-side as SHA-256 hashes, 12 h TTL.
- Users in `users.json` with PBKDF2-SHA256 hashes; roles `viewer` < `operator` < `admin` enforced per route in `routes.go`.
- Login rate limit: 5 failures per client+user lock them for 15 minutes.
- Every non-GET request (including rejected ones and logins) is appended to `audit.log`.
- No TLS termination: use Tailscale Serve or a reverse proxy.

## Real integration environment

The primary test host is Ubuntu Server with Docker installed directly on the host, not Docker Desktop.

The developer has a non-trivial real Docker environment containing many containers. Examples seen during development included:

- transmission
- filebrowser
- pairdrop
- Arcane
- homepage
- big-bear-dockhand
- adminer
- cloudbeaver
- Ollama
- big-bear-portainer
- prowlarr
- CouchDB
- radarr
- big-bear-dozzle
- firefly
- flaresolverr
- big-bear-btop
- convertx

Do not hard-code this list. It changes over time and exists only as evidence that the real integration environment is useful for testing.

The developer's Mac and mobile phone can reach the server through Tailscale. This is useful for responsive/mobile testing and remote access testing.

## What has been proven

The following path is working:

```text
Browser
  -> React/Vite UI
  -> /api proxy
  -> Go CoreOps API :8082
  -> Docker Engine
  -> real containers
```

The Containers view now displays real containers from the server.

The lifecycle workflow has also been manually validated against Docker on the Ubuntu Server: start, stop and restart operations update the UI and reconcile with the real container state, including stopping and starting a disposable test container.

## Mobile

`frontend/android` and `frontend/ios` are Capacitor projects. Android has a native Kotlin drawer/toolbar around the WebView (`MainActivity.kt`); iOS is the stock Capacitor project and has not been validated. The native build calls the backend directly using the server address entered on the login screen (stored locally; `VITE_API_BASE_URL` overrides it).

## What is not finished

See `roadmap.md` for the full checklist. Highlights:

- Container logs and metrics, richer inspection and destructive operations.
- Backend tests for Docker handlers and system parsers (auth has tests).
- UI for the audit log and for user management (users are managed through the CLI).
- Hiding UI actions the current role cannot perform (the API already enforces them).
- Server address configuration screen and secure token storage on mobile.
- Multi-host, Kubernetes and cloud integrations.

CPU, memory, restart count and other richer operational data may still require additional backend endpoints. Do not fake these values.

## Important historical issue

The project originally had a Docker SDK compatibility problem. The backend was migrated to the Moby client dependency set and `go mod tidy` produced the required dependency graph. The resulting backend builds/runs successfully.

Do not revert to the old incompatible Docker client dependency merely to simplify imports.
