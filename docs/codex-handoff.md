# Codex Handoff

## Prerelease Android publicada — 2026-11-23

[CoreOps Android v0.1.0](https://github.com/ppdev28/CoreOps/releases/tag/android-v0.1.0) publicada como prerelease pública.
Tag `android-v0.1.0` → commit `07ca5a2328502267aaec946c5c547969fcd99af5`; sólo se empujó la etiqueta,
main remoto continúa en `85b45d5` y no se activó el deploy legacy del servidor.

APK universal firmada 0.1.0/versionCode 1, min API 24, target 36, 6.785.115 bytes.
SHA-256 APK: `7a331eef9952c1efd21dde96945b24271551abdba888b7f3bb992706605b57bd`.
Certificado SHA-256: `1bed357222b6aeb0e96601c46a35a2927e92b788f1df6204ced8fc0344c214bb`.
Adjuntos: APK, SHA256SUMS, certificado público PEM, build-info.json e informe.
Cinco digests de GitHub contrastados con los artefactos locales.

Build desde export limpio del commit: build/formato/fronteras web, cap sync,
assembleRelease/lintRelease (0 errores/12 avisos), apksigner v2/RSA-3072 y zipalign
correctos. Los 86 assets coinciden con dist. Manifest y flags instalados confirman
sin debugging/backup. Instalación, arranque, login/drawer revisados visualmente en
emulador Android 16 aislado, ya apagado. No se reutilizan credenciales reales;
la APK debug/datos del Redmi se conservan. No equivale a probar login contra API
real en release ni a una matriz de dispositivos. Pruebas Terminal previas: 26/26.

Clave privada y properties: `~/.config/coreops/android-signing/`; copia local
protegida: `/Volumes/Develop/android-data/CoreOps-signing-backup/`. Archivos 0600,
directorios 0700. No adjuntarlos a GitHub; conservarlos para firmar actualizaciones.
Artefactos públicos locales en `dist/releases/android-v0.1.0/` (raíz, ignorado).
Las firmas release/debug difieren: no se desinstala debug ni se borran sus datos.
Backend reciente externo requerido; HTTP/LAN/SEC-03 siguen documentados.

## Primera APK Android de release — 2026-11-23

Preparación de `android-v0.1.0` (0.1.0, versionCode 1), como prerelease pública
sólo del cliente Android. Se configura firma release obligatoria, sin fallback
unsigned/debug, y manifest release sin debugging ni backup Android. El usuario
autoriza una nueva identidad de firma: keystore/properties privados 0600 fuera
del checkout y copia local protegida. No versionar ni adjuntar claves/passwords.

La compilación se realiza desde un export limpio del commit de release, sin
incorporar los documentos ajenos ni el espacio previo en MainActivity. Incluye
la web actual, llave Terminal, iconos redondeados y flechas/Enter corregidos.
No se cambia el backend ni el servicio del servidor. HTTP/LAN se conserva para
compatibilidad; HTTPS y almacén seguro nativo siguen pendientes (SEC-03).

Publicación mediante etiqueta Android y assets (APK, SHA256SUMS, certificado
público e información de build). No push a main: el workflow legacy puede
desplegar/resetear el checkout del servidor. API GitHub mediante gh ya autenticado,
sin extraer tokens del equipo remoto. [Firma y proceso](modules/mobile.md).

## Commits de móvil y sincronización web — 2026-11-23

Registrado en `main`, sin cambiar de rama ni hacer push:

- `920e269` — identidad nativa/iconos redondeados, launcher y generador/licencias.
- `c7cbd38` — frontend actual del servidor y llave de contraseñas de Terminal.
- `9e548d6` — flechas siempre visibles y Enter separado.

La documentación de estas entregas y su validación se registra en un commit
separado. No se incluyen APKs, dist, assets generados por Capacitor, secretos ni
binarios Go. Permanecen fuera los documentos previos sin seguimiento del usuario
(`docs/README.md`, `docs/archive/`, `docs/review-2026-10.md`, `docs/roadmap.md`) y el
espacio previo en `class  MainActivity`. Build web/Android, lint y las 26 pruebas
focalizadas ya se verificaron antes de registrar los cambios; no hubo nuevas
modificaciones de runtime durante la separación de commits.

## Flechas y Enter de Terminal móvil — 2026-11-23

Se reproduce el recorte de flechas en 320/390 px: el grupo direccional estaba
mezclado con Esc/Tab/Ctrl dentro de una tira desplazable junto a Enter. Las cuatro
flechas pasan a un grupo fijo con iconos Lucide y Enter conserva una celda propia.
Hasta 600 px hay dos filas: teclado/atajos arriba, flechas/Enter abajo. En anchos
mayores se mantiene una fila. Áreas táctiles de al menos 44 px y mismo protocolo,
foco, permisos y comportamiento de contraseñas.

`terminal-responsive.spec.ts` comprueba visibilidad completa inicial de las cuatro
flechas, hit testing para detectar controles tapados, separación de Enter y bytes
izquierda/derecha. Falló antes del ajuste en ambos móviles; después se ejecutan
las regresiones de Terminal/contraseñas/contenedores y se reconstruye/sincroniza
la APK Android. Preservar la sincronización web y los iconos de entregas previas;
no sobreescribir Terminal desde el snapshot antiguo del servidor.

Validado: 26/26 escenarios focalizados de Terminal (incluidos contenedores,
contraseñas, teclado/foco/orientación y ocho tamaños), build/fronteras/formato web,
cap sync Android, assembleDebug y lintDebug (0 errores, 14 avisos de mantenimiento;
además flatDir/configuration-on-demand y NO_COLOR/FORCE_COLOR del runner).
Los 86 assets se verifican idénticos en dist, copia Capacitor y APK. Instalada con
-r en el Redmi, datos conservados. Comprobación visual y bounds nativos de las
cuatro flechas separadas de Enter, con teclado Android cerrado y abierto.
Sin comandos ni operaciones de contraseñas reales. Capturas privadas bajo
`/tmp/coreops-arrows-fixed-*` y pruebas en `/tmp/coreops-terminal-arrows-verified`.
No build iOS ni cambios en el servidor; preservar el resto del trabajo pendiente.

## Sincronización del frontend web en Android — 2026-11-23

La primera APK de iconos se construyó/sincronizó correctamente, pero desde el
frontend antiguo del Mac: faltaba la llave de contraseñas de Terminal y otras
mejoras del checkout del servidor. Se importa una instantánea explícita del
frontend actual de `~/proyectos/CoreOps` en `ppserver` (`develop`, incluidos sus
cambios pendientes) a este checkout `main`, sin cambiar ramas ni tocar el remoto.
Se conservan los iconos nativos redondeados. A petición del usuario se retira el
logo de la toolbar Android; permanece en drawer y launcher.

Sincronizados código/assets/licencias/pruebas web y package/lockfile: llave de
Terminal, Applications/logos, Network/puertos, Security, Settings/Tailscale,
Updates y jerarquía visual. CLI Capacitor 8.6.2 con instalación frozen-lockfile.
El contrato `api/typescript` no cambia. No se copia backend: las capacidades
recientes requieren la API actual del servidor; el Go local sigue en su versión
anterior y no debe declararse compatible por haber compilado la APK.

Se ejecuta build antes de cap sync Android y se comprueba igualdad byte a byte
de los 85 assets entre `dist` y el proyecto Android, incluida la llave compilada.
Copias previas y snapshot de origen bajo `/tmp/coreops-*-20261123*`, fuera de Git.
Guías: [Móvil](modules/mobile.md), [Terminal](modules/terminal.md),
[Frontend](modules/frontend.md). No commit/push ni reinicio/cambios del servidor.

Validación final: pnpm install --frozen-lockfile, build, fronteras, formato y
cap sync Android correctos. AssembleDebug/lintDebug correctos (0 errores,
13 avisos de mantenimiento; además flatDir/configuration-on-demand). Los 85
assets de dist coinciden byte a byte tanto en Capacitor como dentro del APK.
APK instalada con -r conservando datos. Redmi real: Dashboard actualizado,
logo ausente de toolbar, llave y gestión de contraseña existentes visibles;
se abrió/cerró el diálogo sin revelar, pegar, reemplazar ni borrar el secreto.
La shell vacía creada para esta comprobación se cierra sin ejecutar comandos.

Playwright: 162/163 en la suite completa, incluidos los seis casos de passwords.
El único fallo fue esperar Settings en navegación tablet-portrait; dos
repeticiones aisladas pasaron (2/2), sin causa confirmada. No describirlo como
163/163 en primera ejecución. Avisos adicionales NO_COLOR/FORCE_COLOR y gráficos
de tamaño cero en vistas ocultas. Capturas privadas /tmp/coreops-sync-*.png y
repetición /tmp/coreops-tablet-sync-recheck. Sin build/dispositivo iOS.

## Identidad visual nativa — 2026-11-23

Trabajo en `main` del Mac, sin cambiar de rama ni sincronizar el checkout
`develop` del servidor, que contiene trabajo posterior pendiente. Se conserva
el cambio previo de espacio en la declaración de `MainActivity` y los documentos
sin seguimiento del usuario.

Android usa la identidad grafito/blanca del favicon web en drawer, toolbar,
launcher adaptativo/legacy y recursos raster; añade icono monocromo Android 13.
Los 16 símbolos de navegación y los dos de toolbar se derivan de Lucide, con
trazo 2, extremos/uniones redondeados y la misma semántica de la web (incluidos
Radar para Observability y Activity para Monitoring). El icono iOS 1024 se
regenera opaco desde la misma fuente. No se modifican API, roles ni navegación.

`frontend/scripts/sync-native-icons.mjs` regenera vectores/densidades desde
`public/favicon.svg` y Lucide instalado; requiere Chromium de Playwright.
Licencias ISC/MIT conservadas y empaquetadas con Android. Ver [Móvil](modules/mobile.md).

Validado: build/formato/fronteras web, cap sync Android, assembleDebug y lintDebug
(0 errores, 13 avisos: dependencias, recursos sin uso, bitmap legacy, convenciones
Kotlin/toolbar y textos no traducidos; además flatDir/configuration-on-demand).
APK debug instalada con `adb install -r` en Redmi Note 8 Pro Android, conservando
los datos. Revisión visual real del drawer y toolbar; se corrigieron recorte del
logo y separación del título. Icono iOS verificado RGB 1024 sin canal alpha,
sin compilar iOS ni validar en dispositivo. APK previa en
`/tmp/coreops-before-icon-update.apk` y capturas en `/tmp/coreops-icons-*.png`;
son artefactos temporales, fuera de Git. No commit/push ni cambios en el servidor.

## Commits por funcionalidad — 2026-11-18

- `2cf3edd` — fix(mobile): bind login sessions to the selected server
- `b0aaf86` — feat(users): create persistent accounts from settings
- `13d57c1` — feat(host): add audited power controls for web and Android

Commits en `main`, sin push. Se exportó el índice de cada funcionalidad a un
checkout temporal para comprobar que cada commit construye el frontend por
sí solo; usuarios y energía también pasan sus pruebas Go focalizadas con race.
El informe de validación y los límites de sudo/APK permanecen documentados.

## Usuarios, móvil y energía — 2026-11-18

Trabajado sobre `main`, inicialmente limpio, sin cambiar de rama. Reanudar desde
la entrada nueva de [current-state](current-state.md) y las guías
[identidad](modules/identity-audit.md), [móvil](modules/mobile.md),
[energía](modules/host-power.md); no seguir las referencias históricas a develop.

Implementados usuarios HTTP/UI sólo admin y centro de control admin con
capacidades, hostname/boot ID, confirmación, revalidación y audit previo con fsync;
el núcleo y adaptador están en `internal/hostpower` / `adapters/linuxpower`.
Sin comandos de energía reales durante pruebas. API nueva activa en tmux `%0`,
binario `/tmp/coreops-admin-runtime-rkf2or4_/coreops-api`, configuración/identidad y
frontend `%1` conservados. Nuevas rutas sin auth dan 401 y health LAN da 200.

Móvil: usar `http://192.168.1.128:5173`; el puerto 8082 sólo escucha en loopback.
Servidor elegido prevalece sobre VITE default y token ligado al API. Android
toolbar emite evento local para abrir el centro, sin lógica privilegiada nativa.
Build web y cap sync Android completados; APK y dispositivo **pendientes** por
falta de Java/SDK/adb conectado. No afirmar que la contraseña real suministrada se
ha validado: se verificó conectividad y login con identidad temporal, sin copiar,
guardar o modificar esa contraseña.

Energía sigue deshabilitada por permisos del host. Helper/instalador revisables en
deploy; activación pendiente por sudo interactivo local:
`sudo sh ./deploy/install-power-helper.sh pepe`. Instalar no apaga ni reinicia.
Después refrescar capacidades; no habilitar suspensión si el host no la soporta.
126 escenarios UI correctos, Go race/vet/build correctos; últimos cambios Go
comprobados con regresiones focalizadas. [Informe](administration-mobile-validation-2026-11-18.md).

## Commits por funcionalidad y alcance de Logs — 2026-11-17

A petición del usuario, se registran todos los cambios pendientes en commits
separados, sin cambiar de develop ni hacer push:

- `c85a7de` — feat(dev): add persistent tmux development launcher
- `c97e959` — feat(files): add bounded read-only text and image previews
- `1a4d19c` — feat(terminal): open authenticated container TTY sessions
- `0beb034` — fix(observability): recover private stack configuration safely
- `cfd3824` — style(observability): distinguish navigation and improve spacing
- `82276a3` — fix(logs): freeze pending reads and source updates when paused
- `b0820ac` — feat(applications): inspect member containers with application context

La regla persistente de actualizar docs con cambios muy relevantes y los informes
de validación quedan en el commit de documentación de esta entrega. Consultar
Git para el hash actual. No se versionan secretos, generated/ ni binarios.
La separación de visor y Terminal se comprobó exportando ambos commits por
separado: typecheck TypeScript y pruebas Go focalizadas con race detector correctos.

Logs no es captura exhaustiva en tiempo real: snapshots, ventanas y permisos
limitan la cobertura. La comprobación actual encontró 175 archivos de catálogo,
164 legibles y 11 inaccesibles, más cuatro directorios que no se pueden listar.
Journal sin aviso de permisos en la consulta realizada; no implica cobertura total.
La prueba fue de lectura con una API/identidad aislada, ya retirada, sin ampliar
permisos. [Alcance y evidencia](modules/logs.md#cobertura-comprobada-el-2026-11-17).


## Logs, recuperación de Observability y Applications — 2026-11-17

Sobre el worktree existente de develop, sin descartar el visor/terminal ni el
launcher previo. Pause en Logs cancela una primera lectura pendiente sin crear un
snapshot nuevo ni refrescar fuentes al pausar; Resume/Refresh siguen operativos.
Observability tiene margen/separación/padding consistente y métricas en filas más
legibles. Applications muestra miembros reales por ID, casos ausentes/errores,
refresh y el mismo inspector de Containers con vuelta contextual. Acciones por
rol, confirmación y reconciliación del estado real, con errores persistentes.

Prometheus/Grafana no arrancaban por secretos desaparecidos que Docker convirtió
en directorios. Configuración privada recuperada, token de scraping nuevo coordinado
con CoreOps, ambos servicios recreados con sus volúmenes intactos; exporter sin
recrear. Los dos targets están up. Montajes rechazan rutas ausentes y configure.py
rechaza entradas malformadas sin reemplazar secretos. Launcher carga valores
opcionales sólo en backend respetando exports explícitos. Identidad intacta.

Grafana sigue en loopback: esta cuenta no puede configurar Serve y sudo necesita
autenticación interactiva. La configuración Tailscale existente se conserva.
No se amplió exposición de red ni se cambió la contraseña persistida en Grafana.
Guías: [Logs](modules/logs.md), [Applications](modules/applications.md),
[Observability](observability.md). Validado: formato/fronteras/build web; 115 escenarios UI contando dos repeticiones
previas, y 24/24 específicos tras el último ajuste; cinco pruebas Python,
promtool/Compose y loader Bash. Chromium/API aislada/Docker/Prometheus reales:
3 miembros, inspect/vuelta, pausa/resume, móvil y 2/2 targets, sin mutaciones de apps.
Identidad/API/Vite de prueba retirados. [Evidencia y límites](applications-logs-observability-validation-2026-11-17.md).

API actual en el panel Backend de tmux `coreops`, binario
`/tmp/coreops-dev.2dZfh1D5/coreops-api` y nuevas variables de observabilidad;
identidad y frontend 5173 conservados. Sin cambios Go adicionales ni commit/push.


## Visor, iconos y terminal Docker — 2026-11-17

Implementado en `develop`: Observability usa Radar y Monitoring conserva Activity
(web/Android); Files abre texto UTF-8 e imágenes raster en un visor de sólo lectura
con descarga para formatos no compatibles; Terminal de inspect/menú abre una shell
real del contenedor en el workspace persistente. Sólo admin y contenedor running,
sin elevar el usuario de la imagen ni enviar comandos/tokens en URL.

La terminal reutiliza auth/Origin/revocación/límites/audit existentes mediante un
puerto TTY independiente del SDK. Cerrar el attach Docker puede dejar procesos
vivos: usar `exit`, y conservar el aviso explícito. La PTY host conserva su cierre.
El visor limita bytes/concurrencia, exige versión del listado y no ejecuta HTML.
Guías actualizadas: [Files](modules/files.md), [Terminal](modules/terminal.md),
[Observability](modules/observability.md), [Security](security.md).

Validado: Go full race/vet/build; web formato/fronteras/build; 110 escenarios UI
superados contando dos repeticiones aisladas de fallos previos, más 7/7 pruebas
nuevas tras el último ajuste. Chromium/API aislada/Docker real comprobó visor,
UID/TTY/resize/persistencia y exit code. [Evidencia y límites](terminal-files-validation-2026-11-17.md).

API de desarrollo reconstruida en `/tmp/coreops-dev.2dZfh1D5/coreops-api`, panel
Backend de tmux `coreops`; entorno y hashes de users/sessions intactos, health y
rutas nuevas verificadas en 8082 y proxy 5173. Frontend previo conservado. API,
identidad y contenedor de prueba retirados; sin producción ni build nativo.
No se solicitó commit ni push.

Preferencia persistente del usuario registrada en `AGENTS.md`: cada cambio muy
relevante debe actualizar los docs aplicables y el estado/handoff. Se preservan
los cambios previos del launcher en `docs/development.md` y `scripts/`.


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


## Sesiones reales Tailscale SSH — 2026-11-16

La conexión del Mac no generaba sshd: usaba `tailscaled be-child ssh-monitor`, login y bash. Se añade inventario de terminales mediante utmp + logind remoto/activo + UID/TTY/scope/ascendencia, con proveedor Tailscale y acciones de consulta. No señalar shells/monitores/daemon Tailscale ni ampliar sudo. Se corrigen `loginctl --property` repetidos (la lista con comas devolvía vacío) y `who -u` bajo LC_ALL=C (mes textual, PID en columna distinta y año ausente). OpenSSH conserva su cierre con pidfd y tiene regresión real con listener propio.

API de desarrollo actual `/tmp/coreops-tailscale-ssh-api`, PID/log `/tmp/coreops-tailscale-ssh-run/`, 8082 y Vite 5173. Entorno y hashes users/sessions conservados al reiniciar. La terminal real del usuario permaneció abierta y se comprobó en API autenticada aislada + Chromium escritorio/móvil; sin identidades de prueba persistentes. Validación: race del adaptador/core/permisos HTTP, vet/build, ocho pruebas Security y build/formato/fronteras frontend. Ver [guía](modules/host-security.md).

En esta comprobación UFW/fail2ban ya respondían mediante el helper existente del host; esta tarea no instaló permisos ni modificó servicios. `sshd -T` devuelve un error de directorio de separación de privilegios `/run/sshd` ausente, que queda desconocido y es independiente del inventario Tailscale. No crear directorios privilegiados ni cambiar el servicio SSH sólo para ocultar esa tarjeta.
