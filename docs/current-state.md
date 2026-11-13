# Current State

Reviewed on **2026-11-12**, checkout **`develop`**, commit **`ece1b7a`**. Architecture and module layout proposals are documented in [architecture.md](architecture.md), [modules/README.md](modules/README.md) and [modularization-plan.md](modularization-plan.md). They have not been implemented. Security findings: [security.md](security.md).

Last known working milestone: **the Figma-designed Containers UI displays real Docker data and performs tested start, stop and restart operations against the Ubuntu Server Docker Engine**.

## Repository

- GitHub repository: `ppdev28/CoreOps`
- Reviewed checkout: `develop`; confirm the current branch rather than following historical branch names.
- Android template assets/tests were initially left untracked; the user authorized their cleanup on 2026-11-13. See [mobile guide](modules/mobile.md).
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

The latest UI slice (2026-11-13) is on **`feature/ui-redesign`**: the rounded flat visual system now covers every screen, login and workspace chrome. Settings → Appearance supports Dark/Gray/Light/System, eight accent presets and a custom color picker with contrast adjustment. Preferences persist and apply without reloading. Shared tokens/styles replace the Dashboard-only palette. Responsive checks cover all navigation destinations plus container inspection from 320px phones through tablets/laptops to 2560px desktops. The 15-test Playwright fixture suite also covers appearance persistence/System, status and action flows. See [UI style guide](ui-style.md) for commands, scope and native limitations.

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

`pnpm build` passed on 2026-11-12, including strict TypeScript checking. Views are lazy-loaded and charts split into a separate chunk; no chunk-size warning appeared in this run. No browser or native validation was performed in this review.

## Terminal interactiva (2026-11-13)

Implementada en la rama actual `feature/terminal-redesign`: xterm.js con PTY Linux real y WebSocket bidireccional. Pestañas independientes, shell persistente, ANSI/TUI, señales, resize, búsqueda, copia y teclado móvil. Las sesiones sobreviven a la navegación interna y terminan al cerrar la pestaña, desconectar, cerrar sesión o apagar la API. Acceso admin antes de crear procesos, Origin exacto, límites de concurrencia/frame/salida y revalidación de sesión. Ver [contrato y operación](modules/terminal.md).

Validado con `go test -race ./...`, vet/build, frontend formato/build y 20 pruebas Playwright. Además, Chromium conectado a una API aislada y una PTY real: estado, Ctrl+C, `top`, pestañas independientes, resize, conexión >45 s y logout. Se actualizó después la API de desarrollo activa de 8082, que aún devolvía 404 en el endpoint, conservando identidad y configuración. Verificación adicional: proxy Vite preserva Host por LAN/Tailscale; prompt real con `/bin/bash -l`. El cliente comprueba compatibilidad antes de abrir xterm y muestra errores accionables. No se instaló un servicio de producción ni se recompiló Capacitor. Las rutas aisladas legacy permanecen; SEC-01/03/04 y los riesgos legacy de SEC-02 siguen pendientes.

## Backend

Stack: Go (stdlib `net/http`), Moby Docker client, no database (JSON files under `COREOPS_DATA_DIR`).

The backend lives in `backend/cmd/coreops-api` and listens on `127.0.0.1:8082` by default (`COREOPS_HOST`, `COREOPS_PORT`). See `backend/README.md` for configuration.

All backend source is still one `package main`; splitting files has not yet separated transport, use cases and adapters. `go test ./...`, `go vet ./...` and `go build ./...` passed on 2026-11-12.

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
POST /api/v1/terminal/exec | complete             admin (legacy)
GET  /api/v1/terminal/session                     WebSocket, admin first frame
POST /api/v1/security/sessions/{pid}/terminate, /security/fix/{item}   admin
POST /api/v1/updates/refresh | apply              admin
GET  /api/v1/audit                                admin
```

### Security model

- Opaque session tokens (`Authorization: Bearer`), stored server-side as SHA-256 hashes, 12 h TTL.
- Users in `users.json` with PBKDF2-SHA256 hashes; roles `viewer` < `operator` < `admin` enforced per route in `routes.go`.
- Login rate limit: 5 failures per client+user lock them for 15 minutes.
- Mutating requests and login attempts, including rejected ones, are sent to `audit.log`; GET/HEAD/OPTIONS are excluded. Writes can fail after the operation and are not tamper-proof.
- Identity files are cached per process: CLI changes are not reloaded by a running server. Manage users with the service stopped until coherent persistence/revocation is implemented (SEC-01).
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

Android repository cleanup (2026-11-13): backed up all 36 untracked template files, removed 34 unused/conflicting template files and versioned two reviewed `.gitignore` files. Existing native source/resources remain unchanged. Web build and static XML/resource/ignore checks passed; native build could not run because Java and an Android SDK are unavailable here. See [mobile guide](modules/mobile.md) for scope and temporary backup location.

## What is not finished

See [roadmap](../roadmap.md) for priorities and [security.md](security.md) for open security findings. Highlights:

- Container detail logs/metrics and richer inspection: aggregate `/logs` already reads Docker logs and `/monitoring` already uses ContainerStats; these are not absent from the backend.
- The list mapper currently assigns `restarts: 0` and the UI displays it although the list response has no restart count. This violates the unavailable-data rule and needs a code fix.
- Docker handler tests. Auth, roles/audit, apt/UFW/security-event parsers and input validators already have Go tests. Dashboard Playwright fixture tests now exist; broader frontend coverage remains pending.
- UI for the audit log and for user management (users are managed through the CLI).
- Hiding UI actions the current role cannot perform (the API already enforces them).
- Server address configuration screen and secure token storage on mobile.
- Multi-host, Kubernetes and cloud integrations.

Container-specific detail workflows still need explicit contract work; reuse existing real collectors where suitable. Do not fake missing values.

## Deployment limitations

CI includes gofmt, vet, tests and frontend format/build, triggered for main only. The SSH deployment builds `backend/scp-api`, while the checked-in service executes `/opt/coreops/coreops-api`; no installation step reconciles them. Frontend production asset delivery is also not defined by that workflow. The effective server configuration was not inspected; see [operations guide](modules/operations.md).

## Important historical issue

The project originally had a Docker SDK compatibility problem. The backend was migrated to the Moby client dependency set and `go mod tidy` produced the required dependency graph. The resulting backend builds/runs successfully.

Do not revert to the old incompatible Docker client dependency merely to simplify imports.
