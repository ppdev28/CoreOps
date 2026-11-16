# Seguridad: revisión y necesidades

Revisión estática del 2026-11-12 sobre `develop` (`ece1b7a`). No es un pentest ni una verificación de la configuración efectiva del servidor. No se ejecutaron terminal, apt, systemctl, señales ni mutaciones Docker. Las prioridades expresan impacto y orden de trabajo, no vulnerabilidades explotadas.

## Modelo de amenazas

Activos: control del host y contenedores, secretos en entorno/configuración/logs, credenciales CoreOps, sesiones y evidencia de acciones. Actores relevantes: cliente no autenticado, usuario con permisos insuficientes, sesión robada, contenido web malicioso, proceso local y administrador legítimo que comete un error.

Fronteras: navegador/WebView → red/proxy TLS → HTTP/auth → capacidad → adaptador privilegiado → host/Docker; CLI → archivos de identidad compartidos; pipeline SSH → servicio instalado. Comprometer el proceso con acceso al socket Docker puede comprometer el host. La red Tailscale reduce exposición pero no cambia esa autoridad.

## Controles presentes

Bind loopback por defecto; Bearer opaco de 32 bytes con hash en servidor; PBKDF2-SHA256 con salt; TTL; roles por ruta; body limitado en login/terminal/updates; timeouts HTTP y varios de operación; lista de orígenes CORS; validadores de algunas acciones; auditoría de mutaciones/rechazos; pruebas auth y parsers. No afirmar cobertura total a partir de estos controles.

## Hallazgos y criterios de cierre

| ID / prioridad | Evidencia actual | Necesidad y criterio de cierre |
| --- | --- | --- |
| SEC-01 / P0 — corregido 2026-11-15 para binarios actualizados | `auth_persistence.go`: flock permanente, recarga por operación, revocación antes de mutación, revalidación tras PBKDF2, escritura fsync/rename; logout propaga errores | Tests de CLI externo, password/borrado, reinicio, concurrencia, fallos de escritura/lectura y cierre de PTY. Mantiene formatos JSON existentes. Parar versiones antiguas antes de actualizar; no mezclar protocolos de persistencia. Filesystem local requerido. No es una transacción general de dos archivos. |
| SEC-02 / P0 | `terminal.go`: admin ejecuta `bash -lc`, hereda entorno y acumula salida en memoria; timeout 30 s | Política explícita de habilitación y privilegios; entorno mínimo, salida/concurrencia limitadas, terminación del grupo de procesos probada y tratamiento de secretos en auditoría. Es shell intencional, no endpoint anónimo. |
| SEC-03 / P0 | `shared/platform/session.ts` (fachada `lib/auth.ts`): Bearer en localStorage; URL acepta HTTP; Android permite cleartext y backup | Sesión ligada al servidor; HTTPS para release; decisión de sesión web y almacén seguro nativo con migración/borrado probados. Si se adoptan cookies HttpOnly, diseñar CSRF y compatibilidad nativa. |
| SEC-04 / P0 | Unit con grupo docker, sudo en security/updates, sin sudoers versionado | Matriz operación → privilegio → mecanismo y pruebas de denegación; sin shell ni comandos genéricos en sudoers. Docker sigue siendo autoridad de host. |
| SEC-05 / P1 | `auth.go`: rate limit por IP+usuario; mapas en memoria y PBKDF2 por login | Acotar memoria, concurrencia y tasa global; pruebas con nombres variables y proxy; no confiar indiscriminadamente en X-Forwarded-For. |
| SEC-06 / P1 | `audit.go`: append posterior a acción, errores sólo en slog; contenido de terminal redactado; GET omitidos salvo ciclo de vida PTY | Política de fallo, redacción, rotación, retención e integridad; definir auditoría de lecturas sensibles y probar fallos sin fingir durabilidad. |
| SEC-07 / P1 | Inspect de contenedores: env/labels y metadata legacy sin redacción; `internal/transport/httpapi` conserva err.Error en errores JSON legacy | DTOs explícitos, clasificación/redacción de secretos, errores públicos seguros y política de no-cache para datos sensibles; pruebas por rol. |
| SEC-08 / P1 | `security.go`: valida rango PID, después envía señal | Resolver y revalidar sesión/identidad del proceso objetivo, prevenir señal a procesos ajenos y probar PID reutilizado. |
| SEC-09 / P1 | `security.go`: errores de comandos descartados en varias consultas; fallback config UFW | Representar desconocido/configurado/efectivo por separado; fallo de permisos no debe convertirse en falso estado saludable ni inactivo. |
| SEC-10 / P1 | HTTP WriteTimeout 45 s; updates refresh 90 s/apply 20 min; salida CombinedOutput | Diseñar operaciones largas con estado consultable, límites de salida y concurrencia; probar desconexión/reintento sin doble ejecución. |
| SEC-11 / P1 | CORS fijo de desarrollo + configuración; sin política integral de headers en backend | Definir TLS, proxy, orígenes por entorno, CSP/no-cache y límites por endpoint; verificar política efectiva de frontend/proxy, no sólo API. |
| SEC-12 / P1 | Workflow genera `scp-api`; unit apunta a `/opt/coreops/coreops-api`; reset hard en checkout | Instalación/release aislada, binario versionado, frontend entregado y rollback probados. |

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
