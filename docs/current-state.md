# Current State

## Consolidación en Git — 2026-11-23

Las entregas pendientes desde `5f2d7f4` quedan registradas en 12 commits sobre
`develop`: Applications/logos, Network/filtros, contraseñas Terminal, fuente
Updates, regresiones UI, Tailscale/Settings, Security, Restart, Services,
jerarquía visual, instalación systemd/APT y documentación compartida.
Consultar `git log --oneline 5f2d7f4..HEAD` para los identificadores completos.
Las referencias anteriores a «sin commit» describen el estado de cada entrega
antes de esta consolidación. No se ha hecho push ni cambiado el despliegue.

El contenido funcional conserva la validación de la entrega Services siguiente.
Al separar los archivos compartidos se compilaron también las cinco versiones
intermedias Go (Terminal, Tailscale, Security, Services e instalación), mediante
copias temporales del índice con `go test -run '^$' ./...`; sin ejecutar sus tests
ni operar infraestructura. No se añadieron binarios, paquetes o datos privados.

## Reparación de Services con cuenta dedicada — 2026-11-23

La migración omitió permisos para start/stop/restart: systemctl directo como
coreops solicitaba autenticación interactiva. Nueva capacidad opt-in services,
helper check/apply root-owned, stdin JSON estricto, unidad canónica/archivos y
protecciones de CoreOps/energía; adapter Go con límites y sin reintentos. Acciones
operator/admin revalidadas bajo flock, intención durable previa y concurrencia
acotada; UI indica ausencia de permiso y mantiene error visible.

`--add services` conserva permisos existentes, usuarios/sesiones/claves. Paquete
listo: `dist/packages/coreops_0.1.0~dev20261123.1_amd64.deb`. Instalar desde SSH
independiente con `python3 scripts/install-system.py --package dist/packages/coreops_0.1.0~dev20261123.1_amd64.deb --add services`.
No repetir migración. Host comprobado ahora: **0.1.0~dev20261123**, coreops.service
active/running bajo coreops, ALSA active/exited. La activación de esta reparación
sigue pendiente de sudo interactivo; no se han mutado servicios del host.
Estas observaciones sustituyen las versiones/instalación pendiente históricas
que figuran más abajo. Vite sigue independiente del paquete instalado.

Validado: Go full race/vet/build, 36 Python, formato/fronteras/build web, 22 UI,
.deb inspeccionado e integración API→sudo→helper en contenedor descartable con
systemctl simulado. No implica ensayo de systemd real ni cambio de permisos host.
[Guía](modules/services.md), [validación](services-permissions-validation-2026-11-23.md).
Develop, sin commit/push, cambios previos preservados.

## Jerarquía visual recuperada — 2026-11-23

En develop, cambios previos conservados sin commit. Por petición del usuario se
refuerzan Dashboard e inspect: títulos 32–34px, secciones 15–16px/650, métricas
32–42px, valores técnicos mono/12px y etiquetas secundarias diferenciadas. Headers
de tarjeta tienen tono/divisor y elevación discreta; inspect separa identidad,
acciones, navegación subrayada y Runtime. CardHeader compartido usa h2/clases y
Card admite className; preferencias/roles/datos/operaciones se conservan.

Validado: formato/fronteras/build web, 25 UI relevantes (incluyen todas las vistas
en ocho formatos), 15 vistas por fase antes/después en dark/gray/light y 30 casos
de datos largos/pestañas 320–1920px, sin overflow ni errores JS.
[Guía](ui-style.md), [informe](ui-hierarchy-validation-2026-11-23.md).

Estado real comprobado: usuario ya instaló coreops.service, activo bajo coreops y
paquete 0.1.0~dev20261122. Vite 5173 muestra código nuevo; 8082 conserva assets
del paquete instalado hasta upgrade con sudo. No migrar identidad de nuevo.
La sesión actual no tiene sudo no interactivo; preservar servicio/datos/terminales
del usuario. Sin APK, commit, push o publicación APT.
Paquete listo: dist/packages/coreops_0.1.0~dev20261123_amd64.deb. Inspección y
API/web extraídas con host/Docker reales y cuenta temporal correctas a 320/1440px;
cero mutaciones salvo login. Actualizar por apt install desde SSH independiente;
instalación activa todavía 0.1.0~dev20261122.

## Servicio del sistema y APT propio — 2026-11-22

En develop, conservando entregas anteriores sin commit. Paquete coreops amd64/arm64
con web/API en un listener, cuenta/state/config dedicados y helpers root-owned en
/usr/libexec/coreops. Setup migra por pidfd, conserva identidad/sesiones/claves y
configuración, aplica permisos explícitos y comprueba MainPID/inode/liveness.
Backups/rollback del API original ante fallo; CLI version y health/live nuevos.

Un comando: `python3 scripts/install-system.py --migrate-running --enable docker,journal,power,security,security-timer,updates,tailscale`.
Dry-run sin sudo disponible; instalación real **pendiente de sudo interactivo**.
API/tmux anteriores activos, no se han instalado unit/grupos/permisos en el host.
El perfil de empaquetado incluye el helper Restart corregido. Ver [guía](installation.md).

APT propio elegido: genera índices, firmas, hashes inmutables y clave pública;
cliente verifica fingerprint/HTTPS/Signed-By/pin. Sin dominio, clave de producción
o licencia elegida todavía; no afirmar que apt install coreops funciona sin dar
de alta el repositorio. CI main/develop y artifacts amd64/arm64, sin el deploy SSH
legacy/reset-hard. Firma/publicación no ejecutadas remotamente.

Validado: Go full race/vet/build, 26 Python, paquetes inspeccionados, APT real
aislado con descarga/firma/tamper, ciclo instalación/reinstalación/remove/purge en
contenedor, migración/rollback real con systemctl simulado y API/web Chromium
320/1440 sin Vite. No systemd PID 1 real, arm64 nativo, TLS o dispositivo físico.
[Informe](system-install-validation-2026-11-22.md). Sin commit/push.

## Corrección Restart del centro de control — 2026-11-22

En develop, preservando cambios anteriores. Dos intentos reales llegaron al helper
y terminaron en 503; el helper root usaba una opción de systemctl que también
rechaza sesiones SSH de pepe por pertenecer a otro UID. Se cambia el helper a
los tres métodos logind WithFlags con flag 1: respeta inhibidores root, sin force,
skip, autorización interactiva ni fallback. UI/API y sudoers conservan contrato.
Activación pendiente de sudo local: `sudo sh deploy/install-power-helper.sh pepe`.
Instalar no reinicia; no hace falta recompilar API/web. Ver [guía](modules/host-power.md).
No se ha enviado ninguna operación de energía para probarlo.
Validado: 5 Python, Go race de core/adaptador/handlers y 6 UI correctos; syntax y
diff check correctos. Sólo avisos NO_COLOR/FORCE_COLOR del runner. Sin commit/push.

## Security endurecido y ampliado — 2026-11-22

Runtime actual `%0`: `/tmp/coreops-security-runtime-1ayzi8m_/coreops-api`, Go 1.26.11,
SHA probado; entorno/identidad/frontend conservados, scanner habilitado y health
proxy 200. Nuevas rutas sin sesión 401.

Entrega sobre develop, sin cambiar de rama ni descartar cambios previos aceptados.
Security aplica guard admin bajo flock hasta el efecto, audit durable previo con
fallo cerrado, cadena/rotación/verificación local y no-store privado. Amplía APT
(orígenes ligados a distro/exclusiones/ejecución/reboot), contexto SSH, jails/nft y
sensores. Journal paginado, monitor 10 s con checkpoint durable y señales acotadas;
jobs CVE para inventario OS e imágenes SHA locales, sin pull/mutaciones de Docker.

Dependencias corregidas: Go >=1.26.11/x/sys 0.44.0 y CLI Capacitor 8.6.2/transitivos;
govulncheck/pnpm audit sin avisos conocidos. Workflow periódico/PR/main/develop y
script reproducible. Tests Go race/vet/build, regresiones de autorización/audit/
cursores/scanner y 13 Python correctos. UI 160/163 iniciales + 3/3 repetidos tras
ERR_NETWORK_CHANGED de módulos confirmado en trazas. Sin build nativo/APK.

Integración real: 1.594 paquetes OS y 71 de una imagen local existente, scans CVE
completos; kernel cargado 7.0.0-43-generic y muchos hallazgos de kernels 6.8 aún
instalados, no todos equivalen a ataques activos. Monitor/cursor/audit correctos,
role viewer 403/operator 200, cero errores JS y sin modificar servicios, paquetes,
SSH, firewall o Tailscale. Identidad/API/Vite de prueba retirados.

Trivy privado instalado en /home/pepe/.coreops-tools/trivy con DB actualizada.
Helper nuevo, sensores y perfil SSH pepe están preparados pero requieren sudo
local; sólo la clave pública de pepe se pudo prevalidar, no posesión del cliente.
No afirmar IDS/antimalware activos ni endurecimiento SSH aplicado. Reboot pendiente.
[Guía](modules/host-security.md), [validación y runtime final](security-hardening-validation-2026-11-22.md),
[seguridad global](security.md). Cambios sin commit/push; preservar los anteriores.

## Network desktop y revisión Security — 2026-11-22

Se mantiene develop y todo el trabajo previo aceptado pendiente de commit.
Network sólo cambia CSS desde 1024 px: filtros en dos filas, panel delimitado,
campos/etiquetas más legibles y agrupación alineada. Capturas de controles a
320/390/768 px idénticas antes/después. Sin cambios de API o lógica de filtrado.

Security revisado de extremo a extremo y con host real: todas las fuentes ok,
UFW activo con 15 reglas, una jail sshd y APT/timer programados. OpenSSH global
PasswordAuthentication yes y PermitRootLogin prohibit-password, correctamente
marcados con atención. Cero sesiones soportadas detectadas; no implica inventario
exhaustivo de cualquier conexión. Ventana de 107 eventos en esta consulta.

Hallazgos pendientes, sin cambiar Security: revalidación de actor antes del
despacho (SEC-13), audit previo durable (SEC-06), cobertura journal/APT/fail2ban/
Docker parcial y Cache-Control ausente. govulncheck detecta 16 IDs (13 con traza),
con condiciones/plataformas que requieren triaje; API compilada con Go 1.26.8.
pnpm audit: cuatro avisos en tooling dev, uno high y tres moderate. SEC-14 y
[revisión detallada](network-desktop-security-review-2026-11-22.md) registran IDs,
prioridades y versiones; no se actualizó toolchain, lockfile o paquetes del host.

Validado: web fronteras/formato/build, 16/16 pruebas UI Network/Security, race
focalizado backend, SSH propio loopback con pidfd y tres reproducciones mediante
fakes/overlay temporal. API/Chromium reales sólo lectura, sin errores JS ni POST
Security; identidad temporal retirada, Tailscale intacto. Vite 5173 sirve el CSS;
API previa conservada, sin reinicio, APK, commit o push.

## Tailscale en Settings y responsive móvil — 2026-11-22

API activa en tmux `%0`: `/tmp/coreops-tailscale-runtime-_2hh1cds/coreops-api`,
binario probado verificado por SHA-256. Entorno, usuarios/sesiones y frontend
conservados; health proxy 200 y Tailscale sin sesión 401.

Se mantiene `develop` y la entrega anterior aceptada pendiente de commit.
Settings → Tailscale sólo admin muestra daemon, IP/DNS, avisos y dispositivos
visibles con filtros. Permite conectar/desconectar, preparar login y editar
hostname, DNS, rutas aceptadas, SSH y bloqueo entrante mediante cambios parciales,
confirmación escrita y permisos/audit previos. Núcleo/adaptador independientes;
sin claves, logout ni acceso directo del navegador a infraestructura.

Settings mejora navegación horizontal en móvil, campos apilados, espacios y áreas
táctiles de 44 px, con guardado local accesible. Ver [módulo](modules/tailscale.md)
y [validación](tailscale-settings-validation-2026-11-22.md).

En la prueba real Tailscale 1.104.7 estaba Running con 27 peers visibles y SSH
activo. Se conservan nodo/preferencias: cero solicitudes de mutación. La cuenta
API pepe puede leer pero no escribir; helper restringido preparado, no instalado.
Activación local con `sudo sh deploy/install-tailscale-helper.sh pepe`, después
refrescar la sección; instalar no cambia la conexión.

Validado: Go full race, regresiones focalizadas tras guards finales, vet/build,
fronteras/formato/build web y 5/5 tests del helper simulado. Playwright 153/154
iniciales + 1/1 repetido por ERR_NETWORK_CHANGED de carga de módulos confirmado
en traza; 14/14 nuevos correctos. Sin cap sync/build APK ni prueba en móvil físico.
Detalle de incidencias en el informe. Cambios pendientes de commit, sin push.

## Applications, Network, contraseña Terminal y fuente Updates — 2026-11-22

Rama real confirmada: `develop`, inicialmente limpia, sin cambiar de rama. Se
mantienen los commits anteriores de main integrados en este checkout. Applications
combina filtros por categoría/estado/miembros y búsqueda por metadatos reales de
contenedores, con ordenación y Clear filters. Incorpora 40 logos locales y reserva
Lucide, sin mostrar una URL como texto cuando falla una imagen; se reutilizan en
los miembros. Fallos del inventario de miembros no ocultan el catálogo de apps.

Network usa tabla de bindings con grupos plegables por protocolo/origen/contenedor/
proceso, búsqueda, rangos, estado, dirección de bind y orden. La asociación Docker
considera protocolo+puerto+IP y deja desconocida una atribución ambigua o fallida;
el parser conserva el nombre completo del proceso. No mide exposición a Internet.

Terminal guarda una contraseña cifrada por usuario/destino en el servidor y la
llave la pega mediante xterm sin Enter. Permite reemplazar/olvidar; un cambio de
pestaña/contexto cancela el pegado. API admin y revalidación bajo flock, AES-GCM,
clave/JSON 0600, sin valor en preferencias, portapapeles o audit. Files protege
clave y almacén. No es aislamiento frente a root/cuenta API/terminal admin; TLS
sigue siendo necesario para secretos en tránsito. Updates añade A−/A+, 10–24 px,
guardado automático en preferencias locales (12 px por defecto).

Validado: Go full race/vet/build; fronteras/formato/build web; suite de 139 escenarios
UI (135 pasaron inicialmente y cuatro, con ERR_NETWORK_CHANGED verificado en las
trazas de carga, pasaron al repetirlos). Tras un ajuste final que conserva filtros
activos vacíos al refrescar, 8/8 escenarios de filtros/fuente correctos, incluida
una regresión nueva: 140 casos cubiertos en total. Pruebas específicas incluyen
320/1440 px y múltiples tamaños Terminal. API/identidad temporales con Docker y
ss reales verificaron 22 aplicaciones, 75 bindings y PTY propia con lectura oculta:
pegado exacto, sin Enter automático, sin eco ni secreto en almacenes del navegador.
No se mutaron contenedores, puertos, paquetes o contraseñas reales del usuario.

API actual en tmux `%0`: `/tmp/coreops-nov22-runtime-d9jkt3ft/coreops-api`, igual
por SHA-256 al binario probado. Entorno, users.json/sessions.json y frontend
conservados; launch privado eliminado. Health del proxy 200 y rutas nuevas sin
sesión 401. Recursos/identidad de validación retirados. No build/sync nativo ni
dispositivo Android; recompilar APK para llevar estos assets al móvil. Cambios de
esta entrega pendientes de commit, sin push.

Guías: [Applications](modules/applications.md), [Network](modules/network.md),
[Terminal](modules/terminal.md), [Updates](modules/updates.md),
[seguridad](security.md). [Informe](usability-validation-2026-11-22.md).

## Commits por funcionalidad — 2026-11-18

- `2cf3edd` — fix(mobile): bind login sessions to the selected server
- `b0aaf86` — feat(users): create persistent accounts from settings
- `13d57c1` — feat(host): add audited power controls for web and Android

Commits en `main`, sin push. Se exportó el índice de cada funcionalidad a un
checkout temporal para comprobar que cada commit construye el frontend por
sí solo; usuarios y energía también pasan sus pruebas Go focalizadas con race.
El informe de validación y los límites de sudo/APK permanecen documentados.

## Login móvil, creación de usuarios y energía — 2026-11-18

Rama real confirmada: `main`; no se cambió de rama. El login móvil usaba el puerto
8082, pero el API de tmux escucha en loopback. La dirección accesible en este
entorno es `http://192.168.1.128:5173`, con CORS nativo a través del proxy. El
servidor seleccionado ahora prevalece sobre el default de build, normaliza un
sufijo `/api/v1` y vincula la sesión a su API; cambiar de servidor borra el token.

Settings → Users permite listar/crear cuentas CoreOps sólo a admin, con nombre,
password y rol (viewer por defecto). Mantiene el store persistente y revalida la
sesión tras PBKDF2 bajo bloqueo; no crea usuarios Linux ni devuelve hashes.
El menú superior de usuario incluye apagado/suspensión/reinicio: capacidades
reales logind, confirmación escrita del hostname, identidad de arranque fresca,
guard de autorización/auditoría previo al despacho y deduplicación temporal.
Android añade acceso de cuenta en toolbar para abrir los mismos controles web.

El servidor actual deniega energía sin autorización local. El helper restringido
y su instalador están preparados, **no instalados**: requiere sudo interactivo
(`sudo sh ./deploy/install-power-helper.sh pepe`), sin ejecutar ninguna orden de
energía durante instalación o validación. Suspensión depende del host/hardware.
Assets sincronizados con Android; no se compiló ni instaló APK por ausencia de
Java/SDK y dispositivo adb. No confundir simulación web con prueba nativa.

Validado: suite Go con race detector, vet/build y regresiones después del ajuste
final; fronteras/formato/build web; 126/126 escenarios Playwright; XML/recursos y
cap sync Android. API/identidad temporales verificaron login, creación y login de
viewer, restricciones y login nativo simulado por LAN; cero órdenes de energía.
Procesos/datos de prueba retirados. API de tmux actualizada al binario probado en
`/tmp/coreops-admin-runtime-rkf2or4_/coreops-api`; hashes de users/sessions intactos
y frontend conservado. Health LAN 200; nuevas rutas sin sesión 401. Las
credenciales entregadas por el usuario no se guardaron ni cambiaron.

Guías: [Identidad](modules/identity-audit.md), [Móvil](modules/mobile.md),
[Energía](modules/host-power.md). [Evidencia y límites](administration-mobile-validation-2026-11-18.md).

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


Latest integrated validation: **2026-11-16**, modular foundation plus all accumulated features, validated for `develop`. See [integration report](integration-validation-2026-11-16.md) and the final section for scope, test results and remaining limitations. The dated baseline below is historical.

Reviewed on **2026-11-12**, checkout **`develop`**, commit **`ece1b7a`**. Architecture and module layout proposals are documented in [architecture.md](architecture.md), [modules/README.md](modules/README.md) and [modularization-plan.md](modularization-plan.md). The first containers/API/shared frontend extraction is now implemented; the broader target remains partial. Security findings: [security.md](security.md).

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

## Primera modularización

Rama `refactor/modular-foundation`, basada en `develop`/`b4d64db`. `api/` contiene contrato OpenAPI inicial y tipos wire; backend separa contenedores en casos de uso, adaptador Moby y HTTP; frontend separa la feature, transporte, sesión y estados compartidos. Las fachadas legacy permiten migrar gradualmente sin cambiar UI/rutas/roles. El contrato se valida contra handlers/middleware reales con dependencias falsas; hay controles automáticos de imports. No hay tercer servicio API, clientes generados, nuevos privilegios ni migración de identidad. La extracción original precedía a la corrección de SEC-01; la integración actual conserva el bloqueo/recarga posterior. Guías junto a cada módulo e inventario en [modules/README.md](modules/README.md). Validado con Go race/vet/build, controles de imports, formato/build web, 23 pruebas Playwright y smoke de lectura sobre Docker real desde una API aislada. No se sustituyó el proceso de desarrollo ni se ejecutaron acciones Docker para esta extracción.

## Backend

Stack: Go (stdlib `net/http`), Moby Docker client, no database (JSON files under `COREOPS_DATA_DIR`).

The backend lives in `backend/cmd/coreops-api` and listens on `127.0.0.1:8082` by default (`COREOPS_HOST`, `COREOPS_PORT`). See `backend/README.md` for configuration.

Container use cases, Docker adapter and HTTP transport are now separate `internal` packages. Remaining capabilities and identity/audit still live in `package main`; see [architecture](architecture.md). `go test ./...`, `go vet ./...` and `go build ./...` passed on 2026-11-12.

Source layout: `main.go` (startup), `routes.go` (route table with minimum role per endpoint), `http.go` (JSON helpers, CORS, logging, env), `auth.go` (users, sessions, roles), `audit.go` (audit log), `users_cli.go` (`coreops-api user ...`), `internal/{containers,adapters/docker,transport/httpapi}` for containers, and one legacy file per area (`host`, `services`, `storage`, `network`, `monitoring`, `logs`, `security`, `updates`, `applications`, `virtual_machines`, `terminal`).

Implemented endpoints (all require a session except health and login):

```text
GET  /api/v1/health                              public
POST /api/v1/auth/login | logout, GET /auth/me
GET  /api/v1/host | storage | network | monitoring | updates
GET  /api/v1/containers, GET /containers/{id}
POST /api/v1/containers                         admin (create)
GET /api/v1/compose; POST /compose/validate | /compose/projects    admin
DELETE /api/v1/containers/{id}                  admin (delete stopped container)
POST /api/v1/containers/{id}/start|stop|restart
GET  /api/v1/applications, POST /applications/{id}/{action}
GET  /api/v1/virtual-machines, POST /virtual-machines/{name}/{action}
GET  /api/v1/services, POST /services/{name}/start|stop|restart
GET  /api/v1/logs[?source=system|file|events], GET /logs/sources       operator
GET  /api/v1/containers/{id}/logs?tail=500                           operator
GET  /api/v1/security
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
- Updated CLI/server binaries coordinate through `.identity.lock` and reload users/sessions per operation; external password/removal changes revoke sessions. SEC-01 correction retains existing JSON formats. Stop older binaries before upgrading; use the same local data directory/service account. See [identity guide](modules/identity-audit.md).
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

`frontend/android` and `frontend/ios` are Capacitor projects. Android has a native Kotlin drawer/toolbar around the WebView (`MainActivity.kt`); iOS is the stock Capacitor project and has not been validated. The native build calls the backend using the server selected on the login screen (stored locally), which takes precedence over `VITE_API_BASE_URL` as of 2026-11-18. In tmux development, use the reachable Vite proxy on port 5173; the API on 8082 binds loopback.

Android repository cleanup (2026-11-13): backed up all 36 untracked template files, removed 34 unused/conflicting template files and versioned two reviewed `.gitignore` files. Existing native source/resources remain unchanged. Web build and static XML/resource/ignore checks passed; native build could not run because Java and an Android SDK are unavailable here. See [mobile guide](modules/mobile.md) for scope and temporary backup location.

## What is not finished

See [roadmap](../roadmap.md) for priorities and [security.md](security.md) for open security findings. Highlights:

- Container detail logs/metrics and richer inspection: aggregate `/logs` already reads Docker logs and `/monitoring` already uses ContainerStats; these are not absent from the backend.
- Container restart counts are now correctly unavailable (`null`/`—`) in list presentation; fine-grained inspect DTOs and other unavailable-value cleanup remain.
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

## File explorer (merged into `develop`, 2026-11-15)

Originally based on `main` (including the Android shell), now integrated with the existing `develop` UI and persistent terminal. The lazy-loaded Files screen implements authenticated host-directory browsing, current-directory search, hidden files, sorting, paginated metadata, direct attachment downloads and streamed uploads with progress/cancellation. Its mobile list has 44px touch controls and wrapped filenames; tablet/desktop retain metadata columns. Transfers and the current directory survive navigation between CoreOps screens. Android includes a document-picker download plugin and folder-aware system back navigation.

The API adds admin-only `/files`, `/files/upload` and `/files/download-ticket`, plus a one-use capability download route. Root access is descriptor confined, uploads never overwrite existing paths, failed uploads are removed and sensitive file operations are audited. Configuration and systemd permission requirements are in `backend/README.md`.

Original feature validation: frontend production build and formatting; Go build, vet, full tests and race detector; real HTTP upload/download integration against a disposable directory. Merge validation on this Ubuntu host: Go race tests/vet/build and frontend format/build pass; Playwright checks include Files at eight viewport sizes and directory/terminal-tab persistence across navigation using isolated API fixtures. Native Android/iOS builds and physical-device file transfers remain unverified. No production service deployment.


## Container creation and identity coherence (`develop`, 2026-11-15)

The existing Containers **Create container** button now opens a responsive dialog with name, local image, environment, command arguments, TCP/UDP port bindings, restart policy and optional start. Creation is admin-only in UI and `POST /api/v1/containers`; existing route roles remain unchanged. Defaults: stopped container, no automatic restart, bridge network, loopback-only port bindings. Local image suggestions come from the real container inventory. No registry pull or arbitrary Docker options are implemented. See [API/operation contract](../backend/README.md#container-creation).

The form prevents duplicate submits, preserves input on errors, refreshes inventory and offers inspection. Partial start failure retains the created ID and prevents creating it again. Missing images/name conflicts and uncertain request outcomes have actionable errors. Before adding this capability, SEC-01 was corrected with file locking, fresh reads, safe revocation ordering and logout error reporting; storage formats stay compatible. Updated CLI/server binaries must be deployed together.

Validation: Go race tests/vet/build; web format/build and 26 Playwright fixture tests, including permissions, validation, pending/error/partial success and a 320px form. Real Chromium → isolated API → Docker created and inspected a disposable local-image container; Docker also confirmed optional start on a second disposable container. Both were removed. Desktop/mobile screenshots were inspected. No production service installation or native build.


## Container deletion repair (`develop`, 2026-11-15)

The previous Delete action only showed a toast; it never called Docker. `container_delete.go` and `lib/api.ts` now implement admin-only `DELETE /api/v1/containers/{id}`. The existing action menu requires confirmation, refuses active containers and preserves volumes/images. Docker independently rejects running-container deletion with force disabled, including races after listing. CORS now permits authenticated DELETE with the existing origin allowlist.

The UI removes rows/selection only after validated API success, refreshes inventory, guards duplicate/concurrent actions and retains a persistent error on failure. Delete is hidden for viewer/operator. Mobile context menus are clamped to the viewport. [Contract](../backend/README.md#container-deletion).

Validation: Go tests/vet/build plus race tests for deletion; frontend format/build and all 34 browser fixture tests, including cancellation, required confirmation, pending/success/error, roles and mobile. Live mobile Chromium → isolated API → Docker deleted only a disposable stopped container. A running deletion returned 409 and left it running; both named/anonymous volumes survived deletion, and a stored marker was read back unchanged. Test containers/volumes and temporary identity were cleaned up. Native builds remain untested.


## Dozzle-inspired log explorer (`develop`, 2026-11-15)

Logs now uses a full-height source sidebar, tabs, two-source comparison, dense timestamped rows, level/search/case/exclude filters, JSON expansion, wrap/display options, per-line/pane copy, filtered download, autoscroll and focus mode. It follows the local Dozzle reader layout with CoreOps themes and responsive layouts. Containers menu and inspect now open the selected container's logs.

New operator-only targeted container snapshots and system-only journal reads avoid collecting every container when opening one. Reads preserve Docker timestamps, whitespace and stdout/stderr/TTY framing; journal uses actual timestamps/priorities. Unknown timestamps remain unavailable, partial/unavailable sources show warnings and byte/line/time limits bound reads. Automatic refresh uses 2 s polling with pause/cancellation; this is a bounded buffer, not a persistent history store or SSE stream. [Contract and module guide](modules/logs.md).

Validation: Go race/vet/build; web format/build and all 42 browser fixtures, including eight viewport sizes. Additional scoped logs/terminal/responsive checks after visual refinements. Real Chromium → isolated API → Docker logs matched Docker CLI data, including stream/timestamp; polling/pause, menu/inspect and dark/light/mobile were checked. Infrastructure was read only; no production/native deployment.

## Host log history and events (`develop`, 2026-11-15)

Logs now includes all retained/readable journal boots, kernel/service/authentication/audit categories, optional unit/time range, discovered host text logs and rotations (including gzip), and retained Docker events. Journal and files are paginated beyond the former 300-record snapshot; pages stay frozen during history navigation. The aggregate remains a recent journal/container snapshot. Coverage, inaccessible sources, retention and archive/decompression limits are explicit; no new host privileges or durable event storage. CoreOps audit stays admin-only. See [Logs](modules/logs.md).

Validation: full Go race tests/vet/build, 45 browser fixture tests and scoped regressions passed; real operator HTTP and Chromium checked journal cursors, five host files, gzip and Docker events on this Ubuntu host, including 320px layout. Host sources remain read only. No native build or production deployment.

## Terminal responsive (`feature/kubernetes-observability`, 2026-11-15)

La terminal aprovecha móvil/tablet/escritorio con herramientas compactas, pestañas activas visibles, objetivos táctiles de 44 px, Enter/teclado fijos y atajos desplazables. Se evita abrir el teclado móvil por autofocus; el viewport visual adapta altura/desplazamiento y conserva la misma PTY al rotar. Modo foco ampliado, búsqueda móvil y medidas reales de filas/columnas. Se corrige el recorte por padding en el cálculo de xterm y se agrupan los ajustes por frame. Backend, permisos y protocolo no cambian. Ver [Terminal](modules/terminal.md#ajuste-responsive--2026-11-15).

Formato/build y 57 pruebas de interfaz completadas (una prueba existente requirió reintento, después pasó aislada), más regresiones Go de terminal con race detector. Validación Chromium con PTY real y `stty size` en móvil, horizontal y escritorio; identidad/shell temporales limpiadas. Teclado visual simulado, sin dispositivo físico ni build nativa.

## Docker Compose creation (`develop`, 2026-11-15)

Create container now offers Single container / Docker Compose. Compose accepts YAML or a UTF-8 file, validates/previews services, and creates a new admin-owned project with optional start (off by default). Local images, named/anonymous volumes and project bridge networks are supported; external files/host binds/builds/privileged fields are rejected. The API uses a bounded, isolated Compose CLI against the same Unix Docker endpoint, private project manifests and real post-operation inventory. Existing projects are never updated by this flow; partial operations remain reserved for inspection. Applications already groups the resulting Compose labels. [Contract/security/recovery](modules/compose.md).

Validation: full Go race tests/vet/build and focused Compose reruns including real CLI validation; frontend format/build and Compose/container creation tests. Real HTTP + mobile Chromium created two disposable projects (multi-service stopped and optional start), verified Docker states/loopback/HTTP, including relative data-directory configuration; all test resources/identity were removed. No production/native deployment.

## Kubernetes operativo — 2026-11-15

En `feature/kubernetes-observability`, Kubernetes añade una pantalla con el estilo CoreOps y distribución responsive. Incluye conexiones HTTPS gestionadas en backend, namespaces/filtros persistentes, resumen, lectura de Workloads/Pods/Nodos, incidencias con evidencia, eventos, YAML y logs actuales/anteriores. Admin configura conexiones; operator escala y reinicia Deployments con revisión explícita del target, comprobación RBAC/UID/resourceVersion y seguimiento del estado observado. No hay métricas ni recursos inventados. [Contrato, límites y validación](modules/kubernetes.md).

Red/configuración/almacenamiento detallados, terminal de pods, métricas históricas y rollback quedan pendientes, identificados como tales en pantalla. Las credenciales de servicio son compartidas entre usuarios CoreOps sujetos a sus roles y al scope configurado; no hay impersonación por usuario. No se encontró un clúster configurado para validación viva: TLS/API y permisos se verifican con httptest, y la interfaz con fixtures aislados. No instalar ni modificar un clúster para rellenar la pantalla con datos de ejemplo.

## Integración de modularización y funcionalidades — 2026-11-16

Se combina `refactor/modular-foundation` con los cambios acumulados de Kubernetes, Compose, creación/borrado, Files, logs y terminal responsive antes de integrar en develop. La extracción es parcial: contrato inicial, contenedores list/inspect/lifecycle y frontend compartido; el resto conserva sus módulos actuales. Se mantienen las 47 rutas autenticadas/roles y la corrección SEC-01. Se corrigen fixtures persistentes, validador de IDs compartido, API frontend create/delete y la reconexión de PTY al cargar pantallas nuevas.

Go race/vet/build y verificación de dependencias correctos; formato/boundaries/build web y 77/77 tests UI correctos. API aislada con Docker real verificó lifecycle/create/delete/logs, subida/descarga y Compose con Nginx loopback; los recursos desechables se limpiaron. Chromium verificó una única sesión PTY autenticada y variable/directorio conservados al navegar entre módulos. No hay validación Kubernetes viva ni build nativo. [Informe reproducible y límites](integration-validation-2026-11-16.md).


## Históricos CPU/memoria — 2026-11-16

Se corrigió el selector 24 h que sólo filtraba datos acumulados por la sesión del navegador. Nuevo GET viewer `/monitoring/history` lee archivos sysstat del host mediante un adaptador confinado, con límites/caché y DTOs propios en `internal/monitoring`. Dashboard y Monitoring usan históricos CPU/memoria con eje proporcional al tiempo y cortes para periodos sin muestras. Los archivos actuales permiten recuperar datos del día anterior; no se inventan periodos fuera de retención. [Guía y validación](modules/monitoring-history.md).

## Security del host — 2026-11-16

Revisión en develop, conservando los cambios pendientes de Files/Updates/sidebar/Dashboard. Se extrae el núcleo de Security a `internal/security` y Linux a `adapters/linuxsecurity`; HTTP/auth/audit siguen compuestos en cmd y la vista sigue legacy. Se elimina la terminación arbitraria SIGKILL por PID: requiere identidad SSH fresca/estable, ejecutable confiable del proceso y padre, permisos efectivos y pidfd con SIGTERM. Admin para acciones, operator/admin para lectura; confirmación obligatoria y resultado real diferenciado de aceptación.

Sesiones con usuario/UID, terminal o notty, PID/padre, ID estable, logind/origen/fecha si existen. Se corrige el año de utmp interpretado como PID y se excluyen registros locales/closing de la enumeración. UFW/fail2ban/sshd/journal no inventan estados saludables al fallar permisos; se corrigen root prohibit-password, autenticación interactiva, jails vacías y programación APT. UI responsive, refresco cancelable cada 15 s/pausa, datos antiguos visibles, errores persistentes y eliminación del CSS global que interfería con sidebar.

Helper opcional de consultas con sudoers exacto y permiso de temporizador separado, preparado **sin instalar**. El usuario actual no tiene sudo no interactivo; UFW, sshd y fail2ban quedan correctamente desconocidos. APT, sockets y journal se consultan realmente. No se alteró ningún servicio del host ni se cerraron sesiones de usuario; la prueba SSH creó su propio listener y conexión loopback. Guía: [Security](modules/host-security.md); evidencia: [validación](security-validation-2026-11-16.md).


## Sesiones SSH del Mac mediante Tailscale — 2026-11-16

Se localizó una terminal real que el inventario anterior omitía al buscar sólo sshd. El adaptador ahora reconcilia Tailscale SSH con utmp/logind activo y la ascendencia del monitor root, muestra proveedor/usuario/TTY/origen/ID y deja sus acciones deshabilitadas. Se corrigen loginctl con propiedades repetidas y who bajo LC_ALL=C (fecha con mes textual, sin año). No se modificó ni cerró la sesión del usuario; OpenSSH conserva sus protecciones de terminación. Alcance y validación en [Security](modules/host-security.md).
