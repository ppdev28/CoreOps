# Seguridad: revisión y necesidades

Revisión estática del 2026-11-12 sobre `develop` (`ece1b7a`). No es un pentest ni una verificación de la configuración efectiva del servidor. No se ejecutaron terminal, apt, systemctl, señales ni mutaciones Docker. Las prioridades expresan impacto y orden de trabajo, no vulnerabilidades explotadas.

## Modelo de amenazas

Activos: control del host y contenedores, secretos en entorno/configuración/logs, credenciales CoreOps, sesiones y evidencia de acciones. Actores relevantes: cliente no autenticado, usuario con permisos insuficientes, sesión robada, contenido web malicioso, proceso local y administrador legítimo que comete un error.

Fronteras: navegador/WebView → red/proxy TLS → HTTP/auth → capacidad → adaptador privilegiado → host/Docker; CLI → archivos de identidad compartidos; pipeline SSH → servicio instalado. Comprometer el proceso con acceso al socket Docker puede comprometer el host. La red Tailscale reduce exposición pero no cambia esa autoridad.

## Controles presentes

### Endurecimiento aplicado al slice Security — 2026-11-22

Se cierran los hallazgos específicos de la revisión previa: MutationGuard bajo
flock de identidad hasta terminar el efecto, intención audit durable que falla
cerrado, rotación/cadena local/verificación, cabeceras privadas, postura contextual
y fuentes ampliadas. Journal paginado con checkpoint/monitor y señales acotadas;
escaneos CVE reales de host/imágenes locales, con estado/frescura/cobertura claros.
Go >=1.26.11 y x/sys 0.44.0, transitivos npm corregidos y checks CI/local sin avisos
conocidos en esta ejecución. [Contrato](modules/host-security.md) y
[validación/estado de activación](security-hardening-validation-2026-11-22.md).

Sensores nuevos y endurecimiento OpenSSH son perfiles manuales root, preparados
con pruebas/validación/backup y rollback SSH. No están activos sólo por existir
el código; sudo interactivo local impide instalarlos desde esta sesión. Usuario
para el perfil SSH: pepe, con preflight público válido (no demuestra posesión de
la clave cliente). El helper existente necesita actualización para nft/jail/Match.
El scanner ya funciona sin sudo con un binario privado. El host tiene reinicio
pendiente. No se mutaron reglas, SSH, contenedores ni paquetes del host.

Las señales no equivalen a IDS/antimalware si esos sensores no están desplegados;
CVE son advisories de paquetes instalados y requieren triaje. La cadena local
no protege frente a root/cuenta API ni sustituye un sink externo. Los hallazgos
globales de terminal legacy, sesión/TLS, autoridad Docker y otros módulos no se
cierran por esta entrega. Las secciones siguientes conservan la revisión anterior.

### Revisión previa, antes de aplicar correcciones — 2026-11-22

Código completo del slice, tests de núcleo/adaptador/HTTP, SSH propio de loopback
y API/Chromium reales de sólo lectura revisados. Todas las fuentes respondieron
en esta consulta: UFW activo con 15 reglas, una jail sshd, APT/timer programados,
107 eventos de la ventana y cero sesiones soportadas detectadas. OpenSSH global
reportó PasswordAuthentication yes y PermitRootLogin prohibit-password; la vista
los marca correctamente con atención. No prueba que root pueda autenticarse
con todas las reglas efectivas ni que exista un ataque.

Quedan P1 en acciones Security: la revocación durante la consulta no impide el
despacho posterior, y un fallo de audit no lo bloquea. Reproducidos con handlers y
fuentes falsas, sin señales reales ni identidades del usuario. Cobertura P2:
journal sin tailscaled/kernel/auditd, sólo 120 registros; APT sin revisar orígenes,
exclusiones o instalación efectiva; fail2ban sin verificar filtros/acciones de cada
jail; UFW sin evaluar Docker/NAT o exposición externa. GET Security no establece
Cache-Control. No es un motor de CVE/IDS ni una evaluación completa del host.

El binario activo usa Go 1.26.8. govulncheck v1.10.0 detectó 16 IDs (13 con traza
de símbolos); incluyen condiciones HTTP/2/TLS y avisos Windows que requieren
triaje de plataforma/configuración, no 16 exploits demostrados. Los avisos stdlib
consultados se corrigen hasta Go 1.26.11: actualizar toolchain y recompilar en una
entrega propia. pnpm audit detectó cuatro avisos transitivos de herramientas de
desarrollo (uno high y tres moderate), sin prueba de explotación en el bundle.
La consulta separada --prod devolvió cero avisos conocidos, 100 dependencias.
No se cambian versiones ni lockfile en esta revisión. [Evidencias, prioridades,
IDs y referencias primarias](network-desktop-security-review-2026-11-22.md).

### Gestión local de Tailscale — 2026-11-22

GET/POST sólo admin, DTOs saneados sin claves/raw prefs, Unix socket fijo, sin
redirects/proxy HTTP del entorno, cuerpos y concurrencia acotados. Cambios con
hostname escrito, revisión del snapshot, relectura, sesión revalidada e intención
auditada con fsync antes de despachar; deduplicación limitada en memoria, sin
garantía durable ni exclusión de CLI externos. PATCH sólo de campos explícitos;
sin logout, auth keys, cambio de control plane, operator, Serve/Funnel o exit node.
Las URLs efímeras de login se limitan al origen HTTPS autorizado y sólo se muestran
en NeedsLogin; no se guardan ni auditan.

Lectura del socket no implica permiso de escritura. Si es necesario, el helper
root de argv fijo y JSON con allowlist independiente concede sólo esta capacidad;
requiere instalación local con sudo y no modifica la conexión al instalarlo.
No se instaló ni se cambió Tailscale en la validación del servidor. La UI advierte
antes de operaciones que pueden cortar el acceso remoto. No resuelve los hallazgos
abiertos de sesiones, TLS o autoridad general de la cuenta API. [Contrato y
activación](modules/tailscale.md).

### Contraseñas de Terminal — 2026-11-22

Nueva capacidad admin explícita, aislada por cuenta/target y revalidada bajo flock
de identidad. AES-256-GCM, nonces aleatorios, AAD de cuenta/destino, archivos 0600,
escrituras atómicas y fallo cerrado ante clave ausente/corrupción/permisos. Files
no puede previsualizar/descargar/borrar el almacén o clave ni precrear esos nombres
por upload en el directorio privado. No hay secretos en preferencias, portapapeles,
URLs o audit; el pegado usa xterm sin Enter y se cancela al cambiar el contexto.
La shell puede mostrar/registrar lo pegado: se requiere una acción del usuario.
La cuenta API/root puede leer clave y datos, y el admin ya dispone de su terminal;
no se afirma aislamiento del sistema, cifrado extremo a extremo o Keystore. TLS y
los hallazgos de sesión/autoridad/audit conservan su alcance. [Contrato y límites](modules/terminal.md#contraseña-guardada-y-pegado-explícito--2026-11-22).

### Usuarios HTTP, sesión móvil y energía — 2026-11-18

GET/POST users sólo admin, JSON limitado, passwords persistidos por el store
existente y revalidación bajo bloqueo tras PBKDF2; respuestas/auditoría sin
credenciales. Sesión cliente ligada al servidor, que prevalece sobre defaults de
build; HTTP/localStorage/backup nativo siguen pendientes de política release.
Energía sólo admin, objetivo hostname/boot ID fresco, capacidades logind,
confirmación escrita, argv fijo, helper opcional con sudoers exacto, intención
auditada con fsync antes del despacho y deduplicación temporal en memoria.
No force, comandos arbitrarios ni pruebas reales de apagado. La instalación
privilegiada del helper requiere un administrador local; no se amplía el bind.
Ver [identidad](modules/identity-audit.md), [móvil](modules/mobile.md) y
[energía](modules/host-power.md). Esto no cierra el resto de SEC-03/04/05/06.

### Visor y terminal de contenedor — 2026-11-17

Visor admin con confinamiento por descriptor, versión antes/después, sólo regular
sin enlace final, límites de bytes/concurrencia y exclusión de identidad/audit.
JSON no-store y texto React/Blob de imágenes raster permitidas; no documentos
activos. Lecturas auditadas sin contenido. La terminal Docker exige admin antes de
inspect/exec y usa el transporte PTY existente con revocación/Origin/límites/audit.
Shell fija, usuario de la imagen, sin elevación ni credenciales de CoreOps.
Cerrar attach no garantiza terminar el exec; la UI lo explica y no utiliza kill
de PID ni stop de contenedor para simular esa garantía. Ver [Files](modules/files.md)
y [Terminal](modules/terminal.md). Los hallazgos abiertos mantienen su prioridad;
no se amplía exposición de red ni permisos del host.

Bind loopback por defecto; Bearer opaco de 32 bytes con hash en servidor; PBKDF2-SHA256 con salt; TTL; roles por ruta; body limitado en login/terminal/updates; timeouts HTTP y varios de operación; lista de orígenes CORS; validadores de algunas acciones; auditoría de mutaciones/rechazos; pruebas auth y parsers. No afirmar cobertura total a partir de estos controles.

## Hallazgos y criterios de cierre

| ID / prioridad | Evidencia actual | Necesidad y criterio de cierre |
| --- | --- | --- |
| SEC-01 / P0 — corregido 2026-11-15 para binarios actualizados | `auth_persistence.go`: flock permanente, recarga por operación, revocación antes de mutación, revalidación tras PBKDF2, escritura fsync/rename; logout propaga errores | Tests de CLI externo, password/borrado, reinicio, concurrencia, fallos de escritura/lectura y cierre de PTY. Mantiene formatos JSON existentes. Parar versiones antiguas antes de actualizar; no mezclar protocolos de persistencia. Filesystem local requerido. No es una transacción general de dos archivos. |
| SEC-02 / P0 | `terminal.go`: admin ejecuta `bash -lc`, hereda entorno y acumula salida en memoria; timeout 30 s | Política explícita de habilitación y privilegios; entorno mínimo, salida/concurrencia limitadas, terminación del grupo de procesos probada y tratamiento de secretos en auditoría. Es shell intencional, no endpoint anónimo. |
| SEC-03 / P0 | `shared/platform/session.ts` (fachada `lib/auth.ts`): Bearer en localStorage; URL acepta HTTP; Android permite cleartext y backup | Sesión ligada al servidor; HTTPS para release; decisión de sesión web y almacén seguro nativo con migración/borrado probados. Si se adoptan cookies HttpOnly, diseñar CSRF y compatibilidad nativa. |
| SEC-04 / P0 | Unit con grupo docker, sudo en security/updates, sin sudoers versionado | Matriz operación → privilegio → mecanismo y pruebas de denegación; sin shell ni comandos genéricos en sudoers. Docker sigue siendo autoridad de host. |
| SEC-05 / P1 | `auth.go`: rate limit por IP+usuario; mapas en memoria y PBKDF2 por login | Acotar memoria, concurrencia y tasa global; pruebas con nombres variables y proxy; no confiar indiscriminadamente en X-Forwarded-For. |
| SEC-06 / P1 — mitigado en Security/energía/Tailscale/Services | Security usa intención durable y falla cerrado; audit común añade flock, hash/secuencia, rotación privada y verificación admin. Legacy explícito, sin garantía contra root | Mantener pruebas de IO/tamper/revocación; extender guards a mutaciones legacy que aún sólo auditan después y configurar receptor externo para integridad independiente. |
| SEC-07 / P1 | Inspect de contenedores: env/labels y metadata legacy sin redacción; `internal/transport/httpapi` conserva err.Error en errores JSON legacy | DTOs explícitos, clasificación/redacción de secretos, errores públicos seguros y política de no-cache para datos sensibles; pruebas por rol. |
| SEC-08 / P1 — mitigado 2026-11-16, verificado 2026-11-22 | Inventario fresco, ID de boot/PID/start, ejecutables OpenSSH confiables, protección de ancestros y pidfd + SIGTERM; sin kill numérico/sudo; Tailscale de consulta | Regresiones y ensayo SSH propio correctos. No confundir identidad del proceso con revalidación de la sesión CoreOps; SEC-13 sigue abierto. |
| SEC-09 / P1 — mitigado para fuentes, verificado 2026-11-22 | Estado por fuente, comprobaciones null/unknown, errores de permisos explícitos y datos anteriores marcados como obsoletos | Mantener regresiones; no equivale a cubrir todos los logs, reglas o vulnerabilidades. Límites de APT/journal/fail2ban en informe nuevo. |
| SEC-10 / P1 | HTTP WriteTimeout 45 s; updates refresh 90 s/apply 20 min; salida CombinedOutput | Diseñar operaciones largas con estado consultable, límites de salida y concurrencia; probar desconexión/reintento sin doble ejecución. |
| SEC-11 / P1 | CORS fijo de desarrollo + configuración; sin política integral de headers en backend | Definir TLS, proxy, orígenes por entorno, CSP/no-cache y límites por endpoint; verificar política efectiva de frontend/proxy, no sólo API. |
| SEC-12 / P1 — mitigado en artefactos, activación pendiente 2026-11-22 | Paquete con binario/web/unit coherentes, cuenta dedicada, migración/rollback, MainPID/inode/version y APT firmado; deploy SSH/reset-hard retirado | Pruebas Go/Python, dpkg y APT reales aislados, setup en contenedor con systemctl simulado. Falta instalar/validar systemd/TLS en host, custodia de firma/licencia/publicación y downgrade histórico. [Guía](installation.md). |
| SEC-13 / P1 — corregido 2026-11-22 | Revalidación y efecto bajo el flock persistente de identidad, sesión/rol/expiración frescos y audit durable previo | Tests de revoke durante evidencia, logout serializado con efecto, audit fallido y roles correctos. Operaciones ya autorizadas terminan antes de que se confirme una revocación posterior. |
| SEC-14 / P1 — corregido en fuentes/build 2026-11-22 | Go mínimo 1.26.11, x/sys 0.44.0, CLI Capacitor 8.6.2/transitivos parcheados; govulncheck y pnpm audit sin avisos conocidos, workflow preparado | Mantener scanner periódico/lockfile; recompilar/desplegar artefacto probado. Esto no parchea todos los paquetes/imágenes del host ni garantiza avisos futuros nulos. |

P0 debe tratarse antes de ampliar exposición o capacidades de alto riesgo. La revisión inicial documentó estos hallazgos. La entrega PTY posterior mitiga parte de SEC-02/06; ver el estado concreto a continuación.

## Referencias

- [OWASP HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html): riesgo de guardar identificadores de sesión accesibles a JavaScript en localStorage.
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): transporte y ciclo de vida de sesiones.
- [Docker Engine security](https://docs.docker.com/engine/security/): superficie de ataque y autoridad del daemon. Montar el socket como read-only no convierte su API en operaciones de sólo lectura.

## Mitigación terminal PTY — 2026-11-13

La nueva [terminal](modules/terminal.md) tiene Origin exacto, auth admin antes del proceso, revalidación por entrada/cada segundo, límites de conexiones/frames, salida acotada mediante ACK, entorno explícito sin credenciales de la API, cierre/recogida de shell y proceso en primer plano, y audit de ciclo de vida sin contenido. Se bloquea OSC 52 y los enlaces requieren interacción. Pruebas de PTY real y navegador completadas. No hay sandbox ni elevación nueva: sigue siendo acceso al host como la cuenta del servicio.

**SEC-02 permanece abierto para `/terminal/exec` y `/terminal/complete` legacy**, que la UI ya no consume: entorno heredado y buffers de salida sin límite. `/exec` ya no escribe el comando en el audit. La PTY no corrige SEC-01 (cambios del CLI externos al AuthStore), SEC-03 (almacenamiento/transporte de tokens), SEC-04 (autoridad de host/Docker) ni la durabilidad/retención de SEC-06. Una shell autorizada puede acceder a archivos/procesos de su propia cuenta; filtrar variables heredadas no es una frontera de secretos. Procesos separados deliberadamente pueden sobrevivir como en una terminal nativa.


## Creación de contenedores — 2026-11-15

`POST /api/v1/containers` exige admin antes de invocar Docker, con DTO explícito y cuerpo de 64 KiB. Sólo imagen local, nombre, entorno, comando como argumentos, puertos y restart policy. No admite opciones arbitrarias de Docker, mounts del host, privileged ni namespaces del host. Puertos sin IP usan loopback y el arranque es opt-in. Auditoría excluye valores de entorno/comando y conserva ID/resultado del arranque. No hay retries ni rollback destructivo tras crear; un fallo de arranque devuelve el ID y estado parcial.

Se corrigió primero SEC-01 con bloqueo/recarga entre CLI y servidor, manteniendo el formato. SEC-02 legacy, SEC-03/04 y demás hallazgos abiertos conservan su prioridad; esta entrega no cambia exposición, autoridad de la cuenta del servicio ni almacenamiento del Bearer. El administrador puede ejecutar imágenes locales con los permisos y defaults normales de Docker; no es un aislamiento adicional del daemon.

## Eliminación de contenedores — 2026-11-15

Endpoint DELETE exclusivo de admin con ID validado, sin body/query, deadline y auditoría. Sin force, eliminación de volúmenes ni links; Docker rechaza contenedores activos incluso si arrancan después de listar. UI exige confirmación siempre, oculta Delete a viewer/operator y conserva errores ante fallos. Se verificó conservación de volúmenes nombrados/anónimos y datos con un contenedor desechable; no cambia los hallazgos abiertos de sesión/autoridad del servicio.

## Explorador de logs — 2026-11-15

Se conserva operator/admin para agregado, journal y contenedor dirigido. Snapshots con no-store, contexto cancelable y límites de bytes/líneas/tiempo/concurrencia; warnings para fuentes fallidas. El navegador representa logs como texto React, limpia ANSI/OSC en un recorrido lineal y no ejecuta HTML/enlaces/comandos del payload. Filtros literales locales, caché sólo en memoria y exportación explícita del buffer visible. No hay socket Docker ni nuevo acceso directo del navegador a infraestructura. Los riesgos existentes de contenido sensible en logs/sesiones/autoridad de la cuenta siguen vigentes.

## Historial y fuentes de logs del host — 2026-11-15

Las rutas de journal, archivos, catálogo y eventos conservan operator/admin y revocación antes del acceso. Journal ejecuta argv validado sin shell; no se añade sudo ni permisos de lectura. Los archivos se resuelven en una raíz por descriptor (`COREOPS_LOG_ROOT`, `/var/log` por defecto), con nombres de logs acotados, sin symlinks ni archivos no regulares/FIFO; contenido siempre texto. Se excluye por inode la auditoría de CoreOps para mantener su endpoint exclusivo de admin incluso si el directorio de datos vive bajo la raíz de logs. Se limitan solicitudes concurrentes, ventanas, mensajes, catálogo y tiempo/descompresión; errores/visibilidad parcial se muestran. Continúan abiertos los riesgos de autoridad del servicio, Bearer/localStorage y contenido sensible de logs; esta entrega no amplía exposición de red ni concede permisos del host.

## Creación Compose — 2026-11-15

Capacidad exclusiva de admin, sesión/revocación y auditoría existentes, sin nuevos permisos del host. YAML acotado y allowlist antes de ejecutar config, sin include/extends/env_file/builds/binds/privileged/dispositivos/host namespaces ni recursos externos. No se heredan valores de entorno del servidor y se reservan etiquetas internas. CLI con argv sin shell, Docker config privada vacía, env-file nulo, mismo socket Unix del cliente Moby, límites/concurrencia/deadline y cancelación de grupo de procesos. Manifiestos con entorno explícito se guardan 0600 bajo la identidad del servicio; no entran en audit/preview/Git.

Se rechazan proyectos existentes y nombres generados de volúmenes/redes sin etiquetas; reserva por directorio y marcador aleatorio de propiedad antes de arrancar. No-recreate/no-build/pull-never, sin force/remove-orphans/down. Creaciones parciales conservan manifiesto/reserva/recursos y se inspeccionan: no se afirma atomicidad Docker ni exclusión frente a operadores externos. La autoridad Docker del servicio, Bearer/localStorage, controles legacy y demás SEC abiertos mantienen su prioridad. Ver [Compose](modules/compose.md).

## Kubernetes — 2026-11-15

La [primera versión](modules/kubernetes.md) usa TLS verificado, credenciales embebidas en perfiles privados, endpoints/targets acotados, roles locales y RBAC upstream, precondiciones UID/resourceVersion y auditoría sin credenciales. No invoca kubectl ni ejecuta kubeconfig plugins, no acepta proxies/rutas de certificados arbitrarias ni sigue redirects. Logs/manifiestos son operator; conexiones admin. Se registra el resultado HTTP de las mutaciones, no un job durable con el resultado final de reconciliación.

Límites pendientes: credenciales de servicio compartidas, sin impersonación o políticas por namespace de cada usuario CoreOps; secretos en disco 0600 sin cifrado adicional; renovación manual y confianza en el admin que configura destinos HTTPS. Límites por petición/colección y seis ramas por snapshot, sin cuota global entre usuarios. Conservar SEC-03/04/06/07/11; esta capacidad no corrige por sí sola sesión web/nativa, autoridad del servicio ni auditoría durable. No ampliar exposición de red para conectarla. Antes de exec de pods/Secret values, definir permisos específicos, tratamiento de lecturas sensibles y auditoría.
## Modularización inicial

El módulo de contenedores y el transporte ya no importan tipos Moby entre capas; los objetos complejos de inspect se convierten en valores JSON propios para conservar compatibilidad. Se prueban roles, validación previa a mutación y auditoría. No se añaden permisos ni operaciones. La extracción conserva la corrección posterior de SEC-01. No corrige SEC-03/04 ni la redacción/durabilidad de SEC-06/07; el contrato declara explícitamente ese alcance.

## Observabilidad — 2026-11-16

Consultas `/api/v1/observability/*` con sesión viewer (también operator/admin).
Catálogo de métricas cerrado, selectores escapados, límites de tiempo/puntos/series,
respuesta y concurrencia; no URL/PromQL arbitrario desde el navegador. Fuentes y
Bearer/CA en servidor, sin redirects, sin proxy del entorno ni TLS inseguro.
Un 401/403 upstream es error de integración, no revocación de la sesión CoreOps.
`/metrics` requiere otro Bearer de scraping y está desactivado sin configuración.
Labels de ruta normalizados, scrapes excluidos y WebSockets diferenciados.

Perfil Compose opcional: puertos loopback, sin socket Docker, secretos privados,
volúmenes persistentes, imágenes inmutables, procesos sin capabilities y sin
privilege escalation. node_exporter necesita lectura del host y namespaces host;
no es una frontera de aislamiento. Grafana exige login, sin acceso anónimo.

La fuente publica los mismos recursos a todos los viewers autorizados: no hay
tenancy ni políticas por host/job; usar una fuente dedicada si se necesita aislar
visibilidad. No mutaciones de infraestructura desde Observability, no se crea un
historial/auditoría de incidentes inexistente. Configuración y recarga de reglas
son tareas operativas del servidor, fuera del frontend; no se añade un endpoint
de edición sin audit. Se conservan los riesgos abiertos de sesión/localStorage,
permisos del servicio, logs/audit y despliegue. [Guía](observability.md).

## Operational repairs — files / updates / hostnames

File deletion is admin, requires fresh metadata and explicit UI confirmation,
uses descriptor confinement and no sudo/recursion, excludes links/devices/dirs and
protects live identity/audit files. Existing OS permissions remain authoritative.
Package operations use bounded jobs with actor/outcome audit, no automatic retry
or inherited API secrets, and a fixed root-owned argv-validating helper. Installation
requires root and grants only that helper in sudoers; no host policy was modified
by the coding session. Jobs are in memory and cannot prove completion after an API
restart; inspect APT before retrying. See [Updates](modules/updates.md).
Vite accepts only explicit owned hostnames plus its normal IP/localhost defaults.


## Security del host — revisión 2026-11-16

Se corrigió la terminación arbitraria de PID: antes bastaba un número y se enviaba SIGKILL; ahora exige sesión OpenSSH autenticada con ID estable, revalidación de ejecutable/proceso/padre y pidfd, SIGTERM y permiso efectivo. No hay sudo para señales. Admin sigue siendo obligatorio en backend y UI; operator sólo consulta. La confirmación muestra usuario/TTY/origen/PID, y HTTP 202 no se presenta como cierre confirmado.

Se corrigió el parser de `who -u` que podía usar el año como PID, así como políticas SSH/root, jails vacías y scheduling APT. Los fallos de permisos permanecen desconocidos, separados por fuente. Se eliminó una inyección global de CSS de sidebar desde Security. Comandos fijos, entorno mínimo, buffers/deadlines/concurrencia limitados; helper opcional de consultas con reglas sudo exactas y permiso de temporizador separado. No instalado en el host automáticamente; no amplía autoridad de la cuenta por defecto.

Guía y límites en [Security](modules/host-security.md). Esto no cierra SEC-02/03/04/06 ni sustituye la revisión de permisos de terminal, Docker, almacenamiento del Bearer y auditoría.


## Detección de Tailscale SSH — 2026-11-16

El inventario admite terminales Tailscale SSH con evidencia conjunta de utmp/logind remoto y activo, UID/TTY/scope y ascendencia hasta un monitor SSH/daemon root de Tailscale. No clasifica shells locales ni sesiones closing como SSH. Se corrigen propiedades loginctl separadas por comas y formato de fecha C de who. Las filas Tailscale son de consulta, sin señales a shell/monitor/daemon, sudo ni modificación de permisos; el cierre OpenSSH mantiene la validación y pidfd existentes. No se afirma cobertura Tailscale sin PTY ni de otras implementaciones. Ver [guía](modules/host-security.md).


## Services bajo cuenta dedicada — 2026-11-23

La migración a coreops omitía el permiso para las acciones systemd. Se añade
capacidad opt-in `services` y broker root-owned con sudo exacto check/apply,
JSON estricto, unidades/acciones acotadas, identidad canónica, archivos/drop-ins
confiables y protecciones de CoreOps/energía (incluidos alias). Sin polkit
interactivo ni sudo genérico. `--add` conserva las capacidades existentes.
Services revalida operator/admin/sesión/expiración con flock hasta el efecto y
exige intención durable previa; extiende SEC-06/SEC-13 a estas tres acciones,
sin declarar corregidas todas las mutaciones legacy ni SEC-03/04.
No es aislamiento de ejecutables de servicios ni del grupo Docker. La activación
en el host requiere instalar el nuevo paquete y setup con sudo local; pruebas
root en contenedor usan systemctl simulado. [Guía](modules/services.md).
