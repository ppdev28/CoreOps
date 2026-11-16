# Codex Handoff

## Correcciones operativas — 2026-11-16

Cambios en develop tras `af69725`: ppserver/IP local, flecha de sidebar con anchura
real en tablet/escritorio, Create container/Compose desde Dashboard, borrado admin
de archivos regulares con confirmación/versión/audit y Updates mediante trabajos
202 con seguimiento. [Validación](operations-validation-2026-11-16.md).

Go race/vet/build y frontend formato/fronteras/build correctos; 95 escenarios web
superados (uno previo necesitó retry y pasó también aislado). Docker/archivos reales
verificados sólo con recursos desechables. API de desarrollo reconstruida con
identidad existente intacta: `/tmp/coreops-operations-api-verified`, log/PID en
`/tmp/coreops-operations-run/`; Vite sigue en 5173.

Updates aún requiere que una persona con sudo instale el helper acotado para la
cuenta `pepe`: `sudo sh deploy/install-updates-helper.sh pepe`. El proceso actual
no dispone de sudo sin contraseña; no se eludió ese límite ni se actualizó el host.
[Instalación y contrato](modules/updates.md), [Files](modules/files.md).


## Observabilidad Prometheus / Grafana — 2026-11-16

Slice implementado en `feature/observability-prometheus-grafana`, creado después
de `b38f993` (históricos sysstat) sobre develop. Instrumentación HTTP/Go real,
catálogo y adapter Prometheus con permisos viewer, pantalla Observability con
contexto URL, alertas activas y Grafana provisionado. Compose opcional Linux
privado con node_exporter del host, retención y credenciales fuera de Git.
No cambia los históricos/vistas existentes ni añade un evaluador de alertas.

[Instalación y contrato](observability.md), [guía del módulo](modules/observability.md),
[evidencia de validación](observability-validation-2026-11-16.md). Validado con
race/vet/build Go, controles frontend y 88 pruebas UI, promtool y scraping/alerta
con fallo y recuperación de un target desechable. Se comprobó el host Ubuntu real,
consulta autenticada y dashboard Grafana; la identidad del usuario se conservó.
No se hizo merge/push ni despliegue de producción. Grafana sigue en loopback: usar
un túnel o configurar una URL pública HTTPS alcanzable desde los dispositivos.


Baseline reviewed 2026-11-12 on `develop`, commit `ece1b7a`. The current modularization work is on `refactor/modular-foundation`, created from clean develop at b4d64db; check the branch before continuing. Do not switch to historical `capacitor-native` or `feature/project-foundation` branches based on older instructions.

## Read and resume

Read the five documents in `AGENTS.md` order, then [module instructions](modules/README.md), [security findings](security.md) and [modularization plan](modularization-plan.md). The user requested documentation first, followed by gradual code implementation and preservation of the Figma UI.

## First modularization slice

The explicit request to separate backend/frontend/API is implemented as a first compatible containers slice, not a third runtime service or wholesale move. `api/` has OpenAPI 3.0.3 health/auth/containers + manual TypeScript wire DTOs. Backend: internal/containers owns Service/Runtime/models; adapters/docker owns Moby and snapshots complex inspect JSON without vendor objects; transport/httpapi owns handlers/DTOs/JSON helpers. Main composes and routes preserves auth/roles/audit. Frontend: features/containers owns API/mapping/model/screens; shared/api and shared/platform own HTTP and the single existing session store; lib facades preserve legacy imports. Screens stay lazy. Restart counts are now unavailable, and valid null inspect collections no longer crash UI.

This advances structural steps 2–4 without adding permissions or operations. SEC-01 is still unresolved and remains the next security priority before new privileged capability work. Other capabilities, fine-grained inspect models, identity/audit persistence and broader feature migration remain pending. See module-local READMEs and the module map. No native changes or generated client.

Validation covers OpenAPI + real middleware/roles/audit/error handling with fake runtimes, real Moby HTTP against a local fake engine, capability invariants, AST import checks and browser actions/null data/session behavior. `pnpm check:boundaries` is added to CI; Go checks run with normal tests. No production Docker mutation is needed for these tests. The OpenAPI dependency is pinned to the most recent release compatible with Go 1.24 and is test-only in production dependency analysis.

## Modularization validation completed

- `go test -race ./...`, `go vet ./...`, `go build ./...`: passed across the executable and extracted packages, including contract/roles/audit/cancellation and import-boundary tests.
- `pnpm check:boundaries`, `pnpm format:check`, `pnpm build`: passed. No new frontend runtime dependencies or state library.
- Playwright: 23 tests passed, including all screens and inspect in eight formats, terminal, shared-session 401/403, restart reconciliation and null inspect collections.
- Read-only real Docker smoke: a temporary API process with a separate identity store matched the live inventory and inspect identity/state/ports/networks/mounts. No Docker lifecycle mutation, host modification or existing identity-file change. The temporary process/data were cleaned up; the running development API was not replaced for this structural refactor.

## Authorized Android cleanup

The user explicitly authorized cleanup of the 36 previously untracked Android files after the terminal commit. All 36 were copied and SHA-256 verified outside the repo under `/tmp/coreops-android-cleanup-05romax3/` (temporary storage). Removed 34 unused/conflicting Capacitor template files; retained and versioned two reviewed `.gitignore` files, including exclusions for local signing keys. No previously tracked native code/resources changed, no `cap sync` and no app/security redesign. Do not restore the template resources merely because older handoffs said to preserve them.

Validation: frontend build passed; XML/Kotlin resource references resolve, no duplicate resource IDs, backup hashes verified and ignore rules cover generated/local files without hiding tracked source. Android assemble could not start: Java/JAVA_HOME missing and no Android SDK configured. See [mobile guide](modules/mobile.md). Native build/device validation remains pending.

## Latest terminal slice (2026-11-13)

The explicit terminal request replaces the isolated-command UI with xterm.js and a real Linux PTY. Branch `feature/terminal-redesign` was already checked out; it was preserved. Backend transport is `terminal_session.go`; frontend remains `views/TerminalView.tsx` with shared API transport and new terminal CSS. No wholesale module extraction. See [terminal module](modules/terminal.md) for protocol, environment, limits, lifecycle, shortcuts and proxy configuration.

Validated: Go race tests/vet/build; frontend format/build; 18 fixture browser tests; real Chromium → isolated API → PTY including `top`, state, signals, independent tabs, resize, >45 s and logout. Credentials/data/shell wrapper for live validation were temporary, with no personal history files or Docker mutations. No deployment or native build. A pre-existing typo in testify’s go.mod checksum was corrected after authenticating the canonical value through Go’s official proxy/sum database; integrity checking was retained.

The frontend keeps shells mounted when navigating. Page reload/disconnect ends them; there is no resumable server session or replay. Lifecycle audit redacts content; legacy exec also redacts commands, but its old environment/output limits still need hardening. CLI/server identity coherence SEC-01 remains unresolved. This upgrades the existing admin shell capability, without adding host privileges or implementing a Linux-user identity mapping.

## Terminal disconnect repair

The active development API on 8082 was an older `go run` binary without `/terminal/session`; it returned 404 and the UI rendered a generic disconnect. Rebuilt/restarted that development process with its existing environment, working directory and identity files. The running corrected binary/log/PID are under `/tmp/coreops-terminal-fix/`; the prior binary was retained there for rollback. Future Go edits require a new build/restart; no systemd service was installed.

Vite now preserves Host (`changeOrigin: false`). Verified 101 upgrades through localhost, LAN and Tailscale; an untrusted Origin still receives 403. Authenticated GET without upgrade returns admin-only capability JSON and starts no PTY. The frontend checks that before mounting xterm, explains outdated backend/404, permits retry and distinguishes failed upgrade from later disconnection. Real Chromium → Vite → isolated API → default login bash verified hostname prompt and commands. Go terminal race tests/vet/build and frontend format/build passed; the browser suite now has 20 passing tests including the two regressions. No existing user/password/session data changed.

## Latest UI slice (2026-11-13)

The user expanded the rounded monochrome styling to all application screens and requested configurable accents and responsive mobile/tablet/laptop/desktop layouts. `.app-workspace` now covers the whole app and login. `lib/appearance.ts` owns palette/contrast policy; `webSettings.ts` persists `accentColor`; `tokens.ts` applies live CSS variables. Settings has eight presets plus custom color and preserves the active view on Save/Reset. Semantic status colors remain independent. See [UI style](ui-style.md).

Existing route and operation behavior remains. Keep the current working tree, including unrelated prior documentation/native assets, intact. Default native chrome is aligned with neutral colors but does not mirror web accent/light preferences; no native build was performed.

Validation commands: `pnpm --dir frontend build`, `pnpm --dir frontend format:check`, `pnpm --dir frontend test:ui` (Chromium required). The suite has 15 tests, including every navigation screen and inspect at eight viewports, plus appearance persistence, System, invalid stored color, gaps, stale data, roles and actions. API calls, including terminal identity lookup, are intercepted in these tests. Live API/device integration remains to be verified separately.

## Actual implementation

React/Vite web UI and Capacitor shells call `/api/v1`; Go API binds `127.0.0.1:8082` by default and owns Docker/Linux/libvirt access. Containers now has separate internal capability, Docker adapter and HTTP transport packages; remaining capabilities/identity are still in package main. Frontend containers is a feature; shared HTTP/session are extracted; lib files remain compatibility facades for legacy consumers. See architecture/current state for the actual partial layout.

Container list/inspect/start/stop/restart already exist; the prior milestone records manual validation on Ubuntu Docker. Host, applications, services, VMs, storage, network, monitoring, logs, terminal, security and updates have implementations with uneven real integration validation. Aggregate logs and metrics already use Docker. Never repeat production mutations merely to re-prove historical milestones.

Sessions, PBKDF2 passwords, viewer/operator/admin roles, login pair lockout and file audit exist. They need hardening, not initial implementation. Updated CLI/server binaries reload locked identity files per operation; use the same service user/data directory and stop older binaries before upgrading. See SEC-01 and the 2026-11-15 follow-up below. Terminal now has an admin-only persistent PTY/WebSocket with session revalidation and bounded flow control, alongside the legacy isolated exec/complete endpoints. It uses the service account’s host privileges; see [terminal guide](modules/terminal.md). Token storage is localStorage; Android allows cleartext/backup. See the complete security register before extending privileged flows.

## Recommended next slice

SEC-01 is corrected for updated binaries through file locking, reload and revocation ordering; see the identity follow-up below. The initial auth/health/container contract and list/inspect/lifecycle backend/frontend extraction are integrated. Next extend that partial contract to create/delete and extract those handlers incrementally; preserve current URLs, JSON behavior and minimum roles. Other capabilities remain legacy and share the extracted transport/session. Remaining P0 risks must precede broader exposure.

Do not do a repository-wide move. Do not introduce microservices or multiple Go modules. Do not generate clients until a contract/tooling decision has been reviewed. New guide per extracted capability should live beside its code and be indexed from the module map.

## Validation completed in this review

- `cd backend && go test ./... && go vet ./... && go build ./...`: passed.
- `cd frontend && pnpm build`: passed, no chunk-size warning.
- No live API, Docker mutation, privileged host command, browser test, native build, dependency audit or deployment was performed.

The earlier untracked Android resources/tests were subsequently cleaned with explicit authorization; see the cleanup section above. CI builds `backend/scp-api`, but the unit starts `/opt/coreops/coreops-api`; installation/frontend delivery remains unresolved. The containers mapper now represents absent restart counts as null/—; other unavailable values and inspect redaction still need review.

## Commands for the next session

```bash
git status --short
git branch --show-current
git log --oneline -5
cd backend
go test ./...
go vet ./...
go build ./...
cd ../frontend
pnpm build
```

Before finishing a slice, inspect scope/diff, run relevant checks, update current state and module guide, and report what changed, what was tested, what remains and how to continue. The user has now requested committing the documentation and UI work after completing the favicon. No deployment or push was requested.

## File explorer handoff

`feature/file-explorer` was based on `main` and is now merged into `develop`, preserving the current UI and interactive terminal. See `backend/README.md#file-explorer` for configuration, API behavior, permissions and native build steps. The feature is isolated in `files.go` / `files_test.go`, `lib/files.ts`, `views/FileExplorerView.tsx`, scoped `styles/files.css` and the Android `CoreOpsFilesPlugin.kt`.

To try the integrated version on the server, check out `develop`, run the existing Go and pnpm validation commands, then start the API and frontend as usual. Default filesystem root is `/`, limited by the service user's permissions. For a smaller shared area set `COREOPS_FILES_ROOT` to an existing directory. Test mobile upload/download using disposable files before rebuilding/installing the Android app.

Merge validation (2026-11-15): Go race tests/vet/build and web format/build; browser fixtures cover Files at eight screen sizes, updated sidebar order and persistent file directory alongside terminal tabs. Native build/device validation remains pending.

Files has its own Suspense boundary inside the screen: loading its lazy chunk must not suspend the mounted terminal and restart its WebSocket sessions. The navigation regression test opens Files after two terminals, enters a folder and verifies both terminal connections and the file path survive repeated screen changes.


## Identity persistence — 2026-11-15

SEC-01 prerequisite: `auth_persistence.go` adds permanent flock + fresh JSON reads to every CLI/server auth operation. Login revalidates hash/role after PBKDF2; user changes revoke first; logout reports storage errors. Existing JSON/hash formats are unchanged. Run only updated binaries with the same service account/local data directory; stop older binaries before upgrade, never unlink `.identity.lock` while running. See [identity guide](modules/identity-audit.md). Historical handoff sections above describe the earlier state.

## Container creation — 2026-11-15

Implemented on `develop` after the Files merge. `container_create.go` and `components/CreateContainerDialog.tsx` connect the existing Containers button to admin-only POST creation with local images, validated configuration and explicit partial start success. Contract/limits: [backend README](../backend/README.md#container-creation). The dialog refreshes real inventory and opens inspection; default is create without start. No image pulling, registry auth, mounts or arbitrary Docker configuration.

Go race/vet/build and web format/build passed; all 26 browser fixture tests passed. Real Chromium tested create→inspect through an isolated API and live Docker; a second disposable container tested optional start. Both containers were removed. The current development API must be rebuilt/restarted when changing Go; production/native deployment is separate.

The development API on 8082 was rebuilt/restarted with the integrated branch, preserving its environment, working directory and unchanged users/session files. Binary: `/tmp/coreops-container-create-api`; log/PID: `/tmp/coreops-container-create-run/`. The Vite frontend remains on 5173 and the create/terminal/files routes are available through LAN/Tailscale. Temporary validation identity data and the isolated API were cleaned up. Creation and identity are recorded in separate commits on `develop`.


## Delete container repair — 2026-11-15

The existing Delete menu was a placeholder that only displayed “Deleted”. It now calls admin-only `DELETE /api/v1/containers/{id}` through `lib/api.ts`. `container_delete.go` validates ID/no query/no body and calls Moby with force/volume/link removal disabled; active-state conflicts return 409. Deletion always requires explicit confirmation. The list tracks pending mutations per ID, removes confirmed rows/selection, refreshes inventory and persists errors even with notifications disabled. Mobile context-menu placement is bounded. [Contract](../backend/README.md#container-deletion).

Validation: full Go tests/vet/build, targeted deletion race tests and web format/build; fixture tests cover delete success/pending/cancel, required confirmation, running state, failures and roles/mobile. Real mobile Chromium deleted a disposable container through an isolated API. Running deletion was refused without stopping it; named and anonymous volumes survived, including marker data. The test resources/temporary identity were cleaned up. Creation/identity changes are preserved in their own commits; production/native deployment is separate.

Development API rebuilt/restarted on 8082 with the same environment/data and unchanged user/session files. Binary `/tmp/coreops-container-delete-api`, log/PID `/tmp/coreops-container-delete-run/`. DELETE is reachable through Vite 5173 and Tailscale and rejects anonymous requests before Docker. The repair is recorded in its own commit on `develop`.

Final browser run: 34/34 passed. Earlier runs saw transient Chromium `ERR_NETWORK_CHANGED` module-load failures on creation/terminal screens; the full rerun passed without needing a test retry (`--retries=1` was available for infrastructure flakes). Go full tests/vet/build and targeted DELETE race tests passed.


## Dozzle-inspired logs — 2026-11-15

Implemented on the same `develop` worktree after the identity/create/delete changes. Logs recreates the installed Dozzle reading layout using CoreOps themes: source sidebar, up to eight tabs, comparison, dense rows, search/case/exclusion/levels, JSON expansion, copy/download, wrap/time/font options and focus mode. Containers menu/inspect now open the actual source. `LogsView.tsx`, `components/LogPane.tsx`, `lib/logs.ts`, scoped CSS and backend `logs.go` own the slice. Read [Logs](modules/logs.md) before continuing.

New targeted container and system-only snapshot routes retain operator permissions. Bounded, cancellable polling replaces full-host collection when selecting a container. Timestamp/whitespace/stream parsing was corrected; no fabricated event timestamps. Pause actually suspends reads; failed refresh keeps explicitly stale data and errors. Lazy Logs has its own Suspense boundary to preserve terminals.

Go race/vet/build, frontend format/build and all 42 fixture tests passed, with scoped reruns after visual/escape-parser refinements. Real Chromium used an isolated operator identity/API to read actual Dozzle container logs, matching Docker CLI timestamps/messages/streams and checking polling/pause, themes and mobile. No infrastructure mutation or native build. Temporary credentials/API are cleaned up; screenshots remain temporary artifacts under `/tmp`.

Development API rebuilt/restarted on 8082 with the existing environment/data, unchanged users/session files and all existing capabilities. Binary `/tmp/coreops-logs-api`; log/PID `/tmp/coreops-logs-run/`. Vite 5173 and Tailscale expose the new authenticated routes. Changes are recorded as separate local feature commits on `develop`.

## Host-wide logs and retained history — 2026-11-15

Requested after the Dozzle-style logs commits: expand host coverage beyond the recent journal snapshot. `logs_journal.go`, `logs_files.go`, `logs_events.go` and the existing UI now provide journal categories/time/unit/cursors, text/rotated/gzip file catalog and pages, and finite Docker event snapshots. Read [Logs](modules/logs.md) for contracts and permissions. No sudo/group changes; inaccessible sources remain explicit. `/audit` and CoreOps audit-file aliases retain their admin boundary.

Live integration detected that journald `--unit=*.service` index expansion exceeds the deadline on this large host. The service category now scans bounded metadata pages with real cursors, including continuation through pages with no service matches. Do not restore the wildcard or restrict all kernel history to the current boot. Text cursors detect replaced/shrunk files; gzip replays decompression to the forward offset and may hit its deadline on deep archives. No persistent log/event index was introduced.

Full Go race tests/vet/build, frontend format/build, 45 fixture tests and targeted reruns passed. Isolated operator HTTP compared retained journal pages, real host files and gzip/Docker event metadata; Chromium verified desktop/mobile without runtime errors. Production/native deployment remains separate. The implementation originated on `develop`; confirm the active branch before resuming and do not commit binaries, credentials or validation screenshots.

Development API rebuilt/restarted on 8082 with the existing environment and byte-identical users/session files. Current binary `/tmp/coreops-host-logs-api`; log/PID `/tmp/coreops-host-logs-run/`. Vite remains on 5173. New routes reject anonymous reads before host access. Isolated validation API and temporary credentials were removed. This slice is recorded in its own feature commit on `develop`; the requested integration target is `feature/kubernetes-observability`.

## Terminal mobile/tablet/desktop — 2026-11-15

Initially implemented on `feature/kubernetes-observability`. The requested follow-up records the slice on `develop` and merges it back into `feature/kubernetes-observability`. This frontend slice updates `TerminalView.tsx`, scoped `terminal.css`, the terminal-only scrollbar class in `App.tsx`, and `terminal-responsive.spec.ts`. Read the [responsive terminal notes](modules/terminal.md#ajuste-responsive--2026-11-15) before changing keyboard/viewport behavior. Tools collapse into a mobile popover, active tabs remain visible, touch targets are 44 px, and Enter/keyboard remain fixed around a scrolling key strip. Touch input no longer auto-focuses on connection/tab changes. Focus mode preserves Escape for terminal programs.

Regression tests caught actual clipping: FitAddon must measure the unpadded inner surface, not the padded emulator wrapper. Font loading precedes the initial measurement; resize work is batched per animation frame, bounded to the server's existing dimensions and skips hidden panes. Visual viewport height/pan are applied without reconnecting. Preserve session-scoped manual font zoom across orientation changes.

Web format/build and all 57 UI tests completed; one existing container-navigation test needed a retry and then passed in isolation. Terminal Go race tests passed. Live isolated Chromium/PTy checks compared `stty size` with displayed dimensions and retained a shell variable across mobile/landscape/desktop, with one authenticated shell. Temporary identity, API and PTY were removed. No backend changes/restart, physical keyboard/phone or native build. Vite 5173 serves the changes; the existing development API remains active. The terminal slice is recorded as a focused commit on `develop` and integrated into `feature/kubernetes-observability`; consult Git history for the commit/merge status.

## Compose creation modal — 2026-11-15

Implemented on current `develop` without a branch switch. Read [Compose](modules/compose.md) before continuing. `compose.go`/`compose_model.go` add admin capability, validation and new-project creation; `CreateComposeForm.tsx` plugs into the existing dialog alongside Single container. `yaml.v3` is a pinned Go dependency. Existing create/delete/lifecycle/terminal behavior is preserved.

The slice deliberately supports local images and isolated project networks/volumes; it rejects host binds, external files/resources, builds, inheritance/interpolation and privileged fields before invoking Compose. Do not bypass pre-validation by handing raw YAML directly to the CLI. Configuration Docker/env are isolated from the API's secrets. Normalized private manifests reserve project names across updated CoreOps processes. Query existing resources by labels AND generated names, including unlabelled volumes/networks. A failure after reservation returns an explicit partial result; no automatic retry, update or deletion.

Validation includes full Go race/vet/build and focused reruns, real Compose config without mutations, browser fixtures and real Docker through an isolated API/admin plus Chromium. Two disposable projects tested stopped multi-service creation and optional start, with ownership, volume/network isolation, loopback ports, duplicate refusal and Nginx HTTP. Relative COREOPS_DATA_DIR was also tested. Test projects/volumes/networks/API/identity were cleaned up. No native build or installed-service deployment. This slice is recorded in a focused feature commit on `develop`.

Final checks: full Go race tests/vet/build passed, focused Compose CLI/race tests passed after the absolute-path correction, and all 64 browser fixture tests passed. Development API rebuilt/restarted on 8082 with the original environment and byte-identical users/sessions; binary `/tmp/coreops-compose-api`, log/PID `/tmp/coreops-compose-run/`. Vite remains on 5173 with the corrected proxy to 8082. All three new Compose routes reject anonymous calls before accessing the host. Physical/native builds remain unverified.

## Kubernetes — primera versión, 2026-11-15

Trabajo en la rama activa `feature/kubernetes-observability`, sin cambiar a develop. Consultar [Kubernetes](modules/kubernetes.md) antes de continuar. Se añaden tres archivos Go aislados (cliente/recursos/tests), cliente TypeScript, vista/CSS y navegación web/Android. La infraestructura sigue exclusivamente detrás de CoreOps. Las operaciones llevan permisos, UID/resourceVersion y auditoría de aceptación; la UI verifica la generación/reconciliación y señala cambios externos. No sustituir los estados sin conexión/RBAC/sin métricas por mocks.

La conexión usa HTTPS con CA de sistema o PEM y token/certificado embebido; perfiles 0700/0600 en el data dir. Son credenciales compartidas, no impersonación de cada usuario. Scope explícito por namespaces y Kubernetes RBAC siempre vigentes. No exec plugins, TLS inseguro, importación de rutas del host ni lectura de Secrets. Terminal de pods/rollback/historial de métricas/red/config/storage son siguientes entregas, no capacidades implementadas.

No se dispone de un clúster real configurado en este host; falta la validación con el API del usuario y el build/dispositivo Android. La guía documenta contratos, límites, pruebas y cómo configurar la conexión. No se ha solicitado commit ni push para esta entrega.

Validación final: Go full race/vet/build, formato/build web y 74/74 tests de interfaz; tras ajustes finales, race/vet/build y 10 escenarios Kubernetes nuevamente correctos. Chromium con API CoreOps aislada real comprobó estado sin clúster y rechazo de conexiones HTTP, sin credenciales Kubernetes persistidas en navegador. Recursos temporales/identidad aislada limpiados. API de desarrollo actual: `/tmp/coreops-kubernetes-final-api`, log/PID `/tmp/coreops-kubernetes-run/`; 8082 y proxy Vite 5173 verificados con identidad existente intacta. Falta integración contra Kubernetes vivo y build nativo Android.


## Integración modular con todas las capacidades — 2026-11-16

El usuario pidió verificar la rama `refactor/modular-foundation` con todos los cambios acumulados e integrar el resultado en develop. Kubernetes se conservó en dos commits de backend/frontend; después se combinó la modularización en la rama Kubernetes y se conciliaron los conflictos sin eliminar rutas nuevas ni revertir SEC-01. Ver [informe de integración](integration-validation-2026-11-16.md).

Validación: Go full race/vet/build y verificación de módulos; Compose CLI real; formato/build/check-boundaries web; **77/77** tests de navegador. Navegación cruzada nueva reproduce y protege PTYs/directorio Files frente a carga lazy de Containers y Kubernetes: los workspaces persistentes están fuera del Suspense de rutas. API aislada + Docker/Chromium validó creación, inspección, start/restart/stop, logs, borrado, upload/download y dos proyectos Compose; todos los recursos temporales se limpiaron. PTY real conservó una variable con una sola sesión autenticada. Sin clúster Kubernetes real ni Java/SDK para build nativo.

Al reanudar, confirmar branch/status; extracción parcial real en internal/ y features/shared. No volver a los imports/handlers eliminados, duplicar el cliente/sesión ni normalizar reinicios desconocidos a cero. El backend create/delete y otros módulos legacy siguen pendientes de extracción y OpenAPI aún es parcial. No se solicitó push ni despliegue de producción.


Integración completada: `7cfb6dd` combina la modularización y `7f040bf` la integra en develop con árbol idéntico al probado. API de desarrollo actual `/tmp/coreops-modular-api`, log/PID `/tmp/coreops-modular-run/`; health/proxy y users/sessions intactos verificados. No se hizo push ni despliegue de producción. El siguiente trabajo parte de develop y mantiene las extracciones parciales documentadas.


## Históricos reales del host — 2026-11-16

Corrección en develop después de integrar módulos: Dashboard mostraba “Earlier data unavailable” porque sólo conservaba el estado React de la sesión. El servidor ya tiene sadf/sysstat y archivos saDD del día anterior. Leer [históricos](modules/monitoring-history.md) antes de continuar. Backend `internal/monitoring` define el puerto/modelo; `internal/adapters/sysstat` lee por descriptor y cmd expone GET `/monitoring/history`. No reinstalar/habilitar sysstat ni guardar métricas ficticias.

CPU y memoria de Dashboard/Monitoring mezclan archivo y live, con timestamps numéricos para conservar distancias temporales reales. La cadencia sysstat del host es de unos diez minutos; la retención depende de sus archivos. Archivo ausente/denegado/ilegible queda explícito. No se añadió historial Docker/Kubernetes/IO de disco/red. Los cambios de Go necesitan actualizar la API activa para evitar 404 en el endpoint nuevo.

Validación históricos: Go full race/vet/build, formato/build/check-boundaries web, 80 escenarios UI correctos tras un reintento en un test existente de logs (repetición aislada correcta). Lectura real de 143 muestras 24 h vía API aislada y Chromium escritorio/320 px/recarga, contrastando CPU/memoria con sadf nativo. No se alteró sysstat ni infraestructura. API de desarrollo actual `/tmp/coreops-history-api`, log/PID `/tmp/coreops-history-run/`; identidad existente intacta y ruta nueva accesible mediante proxy Vite. El usuario solicitó registrar esta corrección en un commit antes de iniciar la nueva entrega de observabilidad Prometheus/Grafana.

## Security — revisión 2026-11-16

Confirmar rama/status: trabajo en develop, con cambios anteriores de operaciones aún pendientes; no descartar ni mezclar silenciosamente. Leer [Security del host](modules/host-security.md). Nuevo core `internal/security`, adaptador `internal/adapters/linuxsecurity`, handlers cmd finos. No restaurar kill numérico/SIGKILL ni el CSS global de sidebar que inyectaba la antigua vista. No equiparar errores de permisos con inactive/0. Las sesiones SSH usan ID estable, terminal real y pidfd; un 202 sólo reconoce la solicitud de señal.

Helper root-owned opcional en deploy, consultas por defecto y `--allow-auto-updates` separado; no instalado por falta de sudo no interactivo, no usar Docker para cambiar sudoers del host. Readback APT/timer obligatorio. Ensayo SSH opt-in crea un servidor propio en loopback sin PTY; no señaliza conexiones ajenas. API de desarrollo actual `/tmp/coreops-security-api-final`, log `api-final.log` y PID en `/tmp/coreops-security-run/`, Vite 5173/API 8082; entorno e identidad conservados. Evidencia y limitaciones en [validación](security-validation-2026-11-16.md). Sin commit, push ni merge solicitados para esta revisión.
