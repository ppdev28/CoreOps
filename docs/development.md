# Development Workflow

## Development environment

The primary development/integration environment is an Ubuntu Server host running Docker directly.

Repository path on that host:

```bash
~/proyectos/CoreOps
```

The developer also works from a Mac and can access the server through Tailscale. The mobile client is useful for responsive and remote-access testing.

## Arranque de frontend y backend con tmux

Desde la raíz del repositorio:

```bash
./scripts/dev-tmux.sh
# Arrancar sin conectar la terminal (también sirve desde automatizaciones):
./scripts/dev-tmux.sh --detach
```

Requiere Bash, tmux, Go, pnpm, curl, ss y las dependencias frontend instaladas
(`cd frontend && pnpm install --frozen-lockfile`). Puede ejecutarse desde cualquier
directorio. Compila la API fuera del checkout, crea la sesión `coreops` con dos
paneles y comprueba el frontend y su proxy a `/api/v1/health`. Si la sesión del
mismo checkout ya existe, la reutiliza sin reiniciar procesos. Si los puertos
5173/8082 están ocupados por otros procesos, se detiene sin matarlos.

La API escucha en loopback:8082 y Vite en 0.0.0.0:5173. Conserva las variables
exportadas del terminal que lanza el script, incluso si tmux ya estaba abierto;
los archivos temporales privados usados para transferirlas se borran al arrancar.
`COREOPS_HOST` y `COREOPS_DATA_DIR` pueden sobrescribirse. El directorio de datos
predeterminado es siempre `backend/data` del checkout; las rutas relativas de
datos se interpretan desde `backend/`. No crea ni cambia usuarios. Una instalación
nueva necesita crear su primer usuario según `backend/README.md`.

Para volver a los paneles: `tmux attach -t coreops`. Para desconectar conservando
los procesos: `Ctrl+B`, después `D`. Para detenerlos: `tmux kill-session -t coreops`.
Tras cambiar código Go, detén la sesión y vuelve a ejecutar el script para
recompilar. Los fallos conservan los paneles para diagnóstico; un health correcto
no valida todas las integraciones ni el login. Es un launcher de desarrollo, no
instala un servicio ni modifica Docker, sudo o la configuración del host.

Observability opcional (2026-11-17): si existe
`deploy/observability/generated/coreops.env`, una sesión nueva carga sus seis
variables conocidas únicamente en el backend, sin ejecutar el fichero. Las
variables exportadas por el usuario prevalecen (también un metrics token inline).
Reutilizar una sesión existente no aplica cambios de configuración. No se arrancan
contenedores automáticamente: seguir [Observability](observability.md).

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

**Identity persistence (2026-11-15):** updated CLI/server binaries lock `.identity.lock`, reload JSON state for every operation and persist revocations before changing users. Use the same data directory and service account. Stop older binaries before upgrading; do not run mixed versions or unlink the lock file. The format of existing users/sessions is unchanged. Use a local filesystem supporting flock, atomic rename and fsync. A password/removal write failure may still revoke sessions; retry the CLI change after resolving storage errors.

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

`.github/workflows/ci-cd.yml` validates main/develop. The legacy SSH/reset-hard
deployment was removed. `packages.yml` builds inspected amd64/arm64 artifacts on
PR/manual runs; signing and publication remain separate.

`deploy/coreops.service` uses packaged /usr/bin/coreops-api, bundled web assets,
dedicated coreops account and persistent state. Production does not need Vite,
Node or tmux. `python3 scripts/install-system.py --dry-run --migrate-running`
previews migration. Installation needs interactive sudo, stops the source API and
closes terminals/jobs. Read [installation](installation.md) before running it.

Package checks: `python3 -B -m unittest scripts/test_packaging.py`, build-deb.py,
verify-deb.py and test-apt-repository.py. These do not install host services or edit
host APT config. Container root setup tests simulate systemctl and require an
isolated PID namespace; never use host PID/root mounts. See [operations](modules/operations.md).

## Documentation-only validation

Check local Markdown links, referenced paths, `git diff --check` and scope. Runtime code is unchanged in documentation tasks; baseline builds may be recorded but do not prove infrastructure or browser behavior. Read [module instructions](modules/README.md) before the next code slice.

## Browser UI checks

`cd frontend && pnpm test:ui` runs the application Playwright fixture suite
(163 scenarios observed on 2026-11-22; count evolves with features). It exercises
navigation, fixtures, actions, roles, themes and responsive layouts. Use CI=true
for a full run to give the runner its own Vite rather than reusing an orphan.
`test:dashboard` invokes the same suite for compatibility. Capture/diagnose module
load ERR_NETWORK_CHANGED from traces before retrying a failed case; don't hide
product failures by raising timeouts.

Install Chromium using `pnpm exec playwright install chromium`, or set `COREOPS_CHROMIUM_PATH` to an existing executable. The suite launches a loopback Vite server on port 5176 and intercepts every API request, including terminal WebSocket traffic. Screenshots/traces are ignored build artifacts. `test:dashboard` invokes the same suite for compatibility. See [UI guide](ui-style.md). Browser fixture tests do not replace live API or physical device testing.

For terminal changes, read [the terminal guide](modules/terminal.md) and run `go test -race ./...`. Backend tests use real PTYs without touching the user’s shell startup/history files; browser fixtures do not execute host commands. Production proxies must support WebSocket upgrade and explicitly configure the external Origin.

After changing Go source, rebuild/restart the API process; a running `go run` binary does not hot reload. Terminal first performs an authenticated capability GET before WebSocket upgrade. A 404 means the active API lacks this feature, even if health succeeds. Vite preserves Host (`changeOrigin: false`) so the browser Origin remains valid over LAN/Tailscale.

For log viewer changes, read [Logs](modules/logs.md). Run Go race tests for the bounded parallel collector and parser. Targeted API reads require operator/admin; automatic updates are cancellable snapshots at 2 s intervals, with the app auto-refresh preference providing the initial state. The Playwright suite uses isolated fixtures, including source endpoints; live Docker validation should be read only.

For host log history, also exercise `logs_host_test.go` and `host-logs.spec.ts`: journal cursor/time/unit filtering, file/gzip paging, rotation and permission failures. Use an isolated operator identity for live reads. Never dump log contents or validation tokens into committed artifacts; do not grant host groups/ACLs just to make a test pass. See [coverage and retained-history limits](modules/logs.md).

Terminal responsive regression tests live in `e2e/dashboard/terminal-responsive.spec.ts`: eight sizes, four tabs, virtual viewport/keyboard, focus mode and literal key delivery. Browser keyboard geometry is simulated; verify physical mobile keyboards and Capacitor separately. Keep real PTY smoke tests isolated from personal dotfiles/history.

For Compose creation, read [Compose](modules/compose.md). Run `COREOPS_TEST_COMPOSE_CLI=1 go test -race ./... -run TestCompose -count=1` for an explicit local CLI-only configuration check. Browser fixtures cover both creation methods; live mutation checks must use unique disposable project names and isolated identity, then remove only their own containers/networks/volumes. Never deploy a user-supplied project as a test.
## Módulos y contrato

La build sigue siendo `go build ./...` desde backend y `pnpm build` desde frontend; conservar `api/` en el checkout porque frontend importa sus DTOs como tipos. `go test ./...` valida `api/openapi.json` y respuestas HTTP/políticas de la primera feature con runtimes falsos. `pnpm check:boundaries` verifica la dirección de imports y se ejecuta en CI, junto a tests Go de fronteras. No se añade un servicio API ni otro proceso a levantar. Guías: [contrato](../api/README.md), [contenedores backend](../backend/internal/containers/README.md), [frontend](../frontend/src/features/containers/README.md).

## Observability

See [installation/formulas/rules](observability.md) and [validation evidence](observability-validation-2026-11-16.md).
The full browser suite now has 88 tests. The optional Linux Compose profile uses
private ports 19090/19100/13000 and immutable image digests; keep CoreOps native.
Python generator tests and promtool config/rule validation also run in CI.
`deploy/observability/smoke.py --token-file /private/viewer-token` checks real series
and a disposable target's pending/firing/recovery; never stop production services
to demonstrate alerting. Browser fixtures still intercept infrastructure calls;
run the smoke separately against the real backend.

## ppserver / LAN and operational repairs

Vite listens on interfaces by default and explicitly accepts `ppserver` and
`ppserver.local`, retaining its default localhost/IP allowance and denying other
hostnames. Access `http://ppserver:5173` or the server LAN IP, currently
`http://192.168.1.128:5173`. The client must resolve ppserver through local DNS,
Tailscale MagicDNS or a hosts entry; allowedHosts does not create DNS records.
No wildcard allowedHosts or CORS bypass is enabled. Same-origin `/api` and WebSocket
proxy keep Host for the terminal's Origin check.

Sidebar uses actual React collapsed state (initially collapsed at 768–1150 px);
its arrow can expand in that interval. CSS no longer forces the narrow width.
Dashboard Create container reuses the admin container/Compose dialog and refreshes
real inventory. Files deletion and Updates contracts are in
[Files](modules/files.md) and [Updates](modules/updates.md).


## Security validation and tools — 2026-11-22

Backend go.mod requires Go >=1.26.11; setup-go uses that file. Run
`./scripts/security-check.sh` to check reachable Go advisories and all npm/dev
advisories (moderate+); `.github/workflows/security.yml` runs on PR, main/develop,
weekly and manual trigger. Normal govulncheck output/exit is intentional: JSON
mode can return 0 while reporting findings. Pin fixes and re-run build/tests;
never dismiss a runtime error as a scanner false positive without triage.

Read [Security](modules/host-security.md) before changing its monitor, guards,
helpers or CVE jobs. `deploy/install-security-scanner.py` installs pinned Trivy as
the API user outside Git; configure its two env vars. Root helper/sensor/SSH
profiles are separate manual workflows; don't use Docker to bypass sudo or test
by changing an existing SSH session, firewall, image or package. Keep generated
binaries, caches, reports/screenshots and any credentials outside Git.
