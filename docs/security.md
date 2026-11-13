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
| SEC-01 / P0 | `auth.go`: usuarios/sesiones en memoria; CLI usa otro proceso; save por archivo y logout ignora error | Coherencia y revocación con servidor activo, errores de disco y reinicio probados; migración de datos documentada. Mientras tanto gestionar usuarios con servicio detenido. |
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

## Modularización inicial

El módulo de contenedores y el transporte ya no importan tipos Moby entre capas; los objetos complejos de inspect se convierten en valores JSON propios para conservar compatibilidad. Se prueban roles, validación previa a mutación y auditoría. No se añaden permisos ni operaciones. La extracción no corrige SEC-01/03/04 ni la redacción/durabilidad de SEC-06/07; el contrato declara explícitamente ese alcance.
