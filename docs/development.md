# Development Workflow

## Development environment

The primary development/integration environment is an Ubuntu Server host running Docker directly.

Repository path on that host:

```bash
~/proyectos/CoreOps
```

The developer also works from a Mac and can access the server through Tailscale. The mobile client is useful for responsive and remote-access testing.

## Frontend

Use pnpm, not npm.

```bash
cd ~/proyectos/CoreOps/frontend
pnpm install
pnpm build
pnpm dev --host 0.0.0.0
```

The frontend normally runs on port `5173`.

When Vite is started with `--host 0.0.0.0`, it exposes the application on the server's reachable interfaces. Prefer testing over the intended private/Tailscale network rather than exposing the development server to the public Internet.

## Backend

```bash
cd ~/proyectos/CoreOps/backend
go test ./...
go vet ./...
go build ./...
go run ./cmd/coreops-api
```

The API normally listens on `127.0.0.1:8082`. Create a user first (see `backend/README.md`), for example:

```bash
# Stop the running API first; use its service user and COREOPS_DATA_DIR.
# The CLI reads the password from stdin; avoid literal real secrets in shell history.
read -rsp 'Password: ' COREOPS_NEW_PASSWORD
printf '%s' "$COREOPS_NEW_PASSWORD" | go run ./cmd/coreops-api user add admin admin
unset COREOPS_NEW_PASSWORD
go run ./cmd/coreops-api
```

Run `go test ./...` and `go vet ./...` before committing backend changes. Run `go mod tidy` only when dependency changes require it.

**Identity caveat (SEC-01):** CLI and server keep separate in-memory stores. Stop the API before adding/removing users or changing passwords, use the same data directory and service identity, then restart it. Do not rely on live CLI revocation until this is fixed. A local development run and the installed systemd service can otherwise use different stores.

## Basic backend checks

Health:

```bash
curl http://localhost:8082/api/v1/health
```

Containers:

```bash
TOKEN=$(curl -s -d '{"username":"admin","password":"a-long-password"}' http://localhost:8082/api/v1/auth/login | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8082/api/v1/containers
```

When validating Docker integration, the API response should be compared with the actual Docker host state. Do not rely solely on mock data or screenshots.

## Frontend/API integration

The frontend uses the Vite development proxy so browser calls can use `/api/...` while the backend remains on `localhost:8082` on the server.

This avoids putting Docker Engine access into the browser and avoids unnecessary CORS complexity during local development.

## Validation order

For a backend change:

1. `go build ./...`
2. run the API
3. exercise the relevant endpoint with `curl`
4. if relevant, exercise the real Docker operation against a safe test container
5. run the frontend build if the contract changed

For a frontend change:

1. `pnpm build`
2. run the frontend
3. verify the relevant view against the real API
4. test loading/error/empty states
5. test desktop and mobile layout where relevant

For a cross-stack change:

1. validate backend compilation;
2. validate API behavior;
3. validate frontend build;
4. run both services;
5. verify the complete browser -> API -> infrastructure path.

## Git safety

Before making changes:

```bash
git status
git branch --show-current
git log --oneline -5
```

The reviewed branch was `develop`; do not automatically pull or switch to historical branches. Inspect upstream and local changes before synchronizing.

Do not commit generated files such as:

- `backend/coreops-api`
- build output in `frontend/dist/`
- local environment secrets
- editor-specific files

Use focused commits. Do not squash/rebase/force-push existing work unless explicitly requested.

## Security rules for development

- Never expose `/var/run/docker.sock` directly to a browser.
- Never add a Docker TCP endpoint without authentication and explicit justification.
- Do not put credentials, API tokens, private keys or secrets in source control.
- Treat Docker lifecycle operations as privileged actions.
- Do not add broad CORS rules as a substitute for a proper deployment/authentication design.
- When an operation can destroy data or stop production services, add explicit confirmation and clear error handling.

## Continuous integration and deployment

`.github/workflows/ci-cd.yml` validates (tests, build, frontend format check) and deploys `main`.

`deploy/coreops.service` is a systemd unit for running the API on the Ubuntu host (the API manages Docker, systemd, apt and UFW of the machine it runs on, so it is deployed as a host service rather than as a container). Create the first user with `coreops-api user add` as the service user, using the same `COREOPS_DATA_DIR` and keeping the service stopped during CLI changes.

The checked-in workflow and unit disagree on the installed binary path; see [operations](modules/operations.md). Do not assume the workflow deploys the new binary or web assets.

## Documentation-only validation

Check local Markdown links, referenced paths, `git diff --check` and scope. Runtime code is unchanged in documentation tasks; baseline builds may be recorded but do not prove infrastructure or browser behavior. Read [module instructions](modules/README.md) before the next code slice.

## Browser UI checks

`cd frontend && pnpm test:ui` runs the application Playwright fixture suite (23 tests). It visits all navigation destinations and container inspection in eight phone/tablet/laptop/desktop formats, waits for real content after lazy loading, and checks runtime errors/overflow, theme/accent persistence, System and Dashboard states.

Install Chromium using `pnpm exec playwright install chromium`, or set `COREOPS_CHROMIUM_PATH` to an existing executable. The suite launches a loopback Vite server on port 5176 and intercepts every API request, including terminal WebSocket traffic. Screenshots/traces are ignored build artifacts. `test:dashboard` invokes the same suite for compatibility. See [UI guide](ui-style.md). Browser fixture tests do not replace live API or physical device testing.

For terminal changes, read [the terminal guide](modules/terminal.md) and run `go test -race ./...`. Backend tests use real PTYs without touching the user’s shell startup/history files; browser fixtures do not execute host commands. Production proxies must support WebSocket upgrade and explicitly configure the external Origin.

After changing Go source, rebuild/restart the API process; a running `go run` binary does not hot reload. Terminal first performs an authenticated capability GET before WebSocket upgrade. A 404 means the active API lacks this feature, even if health succeeds. Vite preserves Host (`changeOrigin: false`) so the browser Origin remains valid over LAN/Tailscale.

## Módulos y contrato

La build sigue siendo `go build ./...` desde backend y `pnpm build` desde frontend; conservar `api/` en el checkout porque frontend importa sus DTOs como tipos. `go test ./...` valida `api/openapi.json` y respuestas HTTP/políticas de la primera feature con runtimes falsos. `pnpm check:boundaries` verifica la dirección de imports y se ejecuta en CI, junto a tests Go de fronteras. No se añade un servicio API ni otro proceso a levantar. Guías: [contrato](../api/README.md), [contenedores backend](../backend/internal/containers/README.md), [frontend](../frontend/src/features/containers/README.md).
