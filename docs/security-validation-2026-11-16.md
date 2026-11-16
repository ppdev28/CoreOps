# Validación Security — 2026-11-16

Rama develop, sobre los cambios pendientes de operaciones. Revisión y correcciones de la capacidad Security; no commit/push/merge solicitados. Implementación, permisos e instalación opcional en [guía](modules/host-security.md).

## Hallazgos corregidos

- `who -u` podía usar el año como PID, confundía hora/idle y clasificaba logins locales como SSH. Ahora sólo enriquece procesos SSH autenticados y presenta usuario/UID, terminal real, PID/padre e identidad estable; origen/hora sólo cuando existen pruebas.
- El endpoint de terminación aceptaba cualquier PID y enviaba SIGKILL. Ahora exige admin, JSON acotado con ID de sesión fresco, ejecutables OpenSSH confiables, permiso del SO, protección de CoreOps/ancestros y pidfd + SIGTERM. Un PID reutilizado o ajeno se rechaza. HTTP 202 no afirma que el proceso ya haya cerrado.
- Errores de UFW/sshd/fail2ban/journal se mostraban como controles inactivos o listas vacías saludables. Ahora son estados independientes de fuente y checks desconocidos, con detalle de permisos/herramientas/errores.
- `prohibit-password` no deshabilita acceso root con clave; desactivar password no prueba autenticación sólo con claves si hay otros métodos. MFA interactivo puede ser intencionado, no un diagnóstico de vulnerabilidad.
- Jails vacías no cuentan como protección activa. Un daemon unattended-upgrades activo no prueba programación: se comprueba política APT efectiva y temporizador persistente. La acción habilita el temporizador fijo, verifica su resultado y no reintenta nombres alternativos.
- Comandos con argv fijo, entorno mínimo, salida/deadline/concurrencia acotados. Helper opcional root-owned con consultas exactas y permiso de temporizador separado; sin señales sudo ni comandos libres. No instalado en el servidor.
- UI respeta roles y permisos efectivos, obliga a revisión de acciones, conserva errores/datos antiguos, cancela consultas, actualiza cada 15 s con pausa y adapta reglas/sesiones a móvil. Se eliminó el estilo global de sidebar inyectado por Security.

## Comprobaciones realizadas

- `go test -race ./...`: correcto; paquete cmd 114,442 s, resto correcto. Después de refinamientos finales de política/errores, nueva ejecución race de núcleo/adaptador, parsers, permisos HTTP, auditoría e identidades correcta.
- `go vet ./...`, `go build ./...` y binario final fuera del repositorio: correctos.
- `pnpm build`, `pnpm format:check`, `pnpm check:boundaries`: correctos.
- Siete escenarios específicos Security correctos: 320/768/1920 px, role operator, revisión + ID enviado + cierre confirmado, refresco fallido con datos anteriores, sesión no verificable. El test de anchura también comprueba que Security no inyecta CSS global de sidebar.
- Suite web completa: **102 escenarios superados**, 100 al primer intento y 2 al reintento (`application.spec.ts`, arranque Dashboard en small-phone/phone, espera inicial de 5 s). En una ejecución anterior, el escenario existente de acceso Containers→Logs agotó espera y pasó aislado; la ejecución completa final lo superó. Esta intermitencia de arranque de tests queda pendiente; no se presenta como un fallo de permisos de Security resuelto.
- SSH **real**, `COREOPS_TEST_OWNED_SSH=1 go test -race ./internal/adapters/linuxsecurity -run TestOwnedSSH -v`: listener propio en loopback, claves/configuración temporales, conexión propia no PTY. Se detectaron usuario pepe, `notty`, PID/parent e IP/puerto 127.0.0.1 reales; se envió SIGTERM mediante pidfd y se confirmó desaparición de la misma identidad. El listener siguió vivo y se limpió al terminar. Nunca se señalizó una conexión existente del usuario.
- Prueba negativa del adaptador con proceso sleep propio: se rechaza como sesión SSH, incluso enviando un DTO que afirma estar verificado. Otros tests rechazan año/PID arbitrario, identidad cambiada, falta de permiso y fuentes incompletas antes de ejecutar señales.
- Helper: `sh -n`, sintaxis sudoers con visudo; cuatro verificaciones de argv/entorno limpio y cuatro rechazos de argumentos en contenedores efímeros, red deshabilitada, filesystem read-only, sin capacidades ni socket/namespace del host. No se ejecutaron UFW/systemctl/fail2ban reales mediante helper y no se cambiaron permisos del host.
- API aislada con usuario/session temporales y fuentes Linux **reales**: UFW/sshd/fail2ban devuelven `permission_denied`; APT/timer, journal, sockets y procesos son accesibles. Firewall null, checks desconocidos, cero sesiones SSH confirmadas en ese momento y APT programado. No se inventaron sesiones para la demostración.
- Chromium contra esa API real, autenticado sin fixtures: escritorio 1440 px y móvil 375 px, sin errores JS ni desbordamiento horizontal. Capturas locales `/tmp/coreops-security-desktop.png` y `/tmp/coreops-security-mobile.png`. Identidad/credenciales/API aisladas eliminadas después.
- API de desarrollo actualizada: `/tmp/coreops-security-api-final`, PID/log en `/tmp/coreops-security-run/` (`api.pid`, `api-final.log`), puerto 8082 y frontend 5173. Health 200; acceso anónimo Security 401. Entorno original conservado, hashes de users/sessions idénticos antes/después de cada reinicio. No se migró identidad ni se activó bootstrap.

## Límites y pasos de operación

El servicio pepe no dispone de sudo no interactivo. Para leer evidencias privilegiadas, un administrador del SO puede instalar el helper de consultas siguiendo la guía; el permiso para activar el temporizador se concede separadamente. La instalación no cambia servicios. No se ha sorteado esta política utilizando Docker.

El ensayo SSH usa una sesión sin PTY porque un sshd no root no puede escribir los registros utmp de una nueva PTY. El parser y la UI cubren `pts/N`; falta comprobar una sesión PTY de usuario real con los permisos definitivos del despliegue. Un namespace/hidepid restrictivo puede limitar la visibilidad; CoreOps no certifica todas las conexiones ni implementaciones SSH.

No se cambiaron SSH, firewall, fail2ban, política APT ni temporizadores del host. Las limitaciones generales de terminal legacy, Bearer/localStorage, autoridad Docker y durabilidad/retención de auditoría siguen en [seguridad](security.md).


## Regresión de Tailscale SSH y locale — misma fecha

La terminal abierta desde el Mac usaba Tailscale SSH: no existían procesos OpenSSH para esa conexión. El adaptador detectó su usuario/TTY/origen/logind/PID mediante fuentes reales cruzadas. También se corrigieron dos errores de interoperabilidad: loginctl no aceptaba la lista de propiedades con comas, y who con el entorno C del API imprimía mes/día sin año en vez de ISO, desplazando la columna del PID.

Verificado sin modificar/cerrar esa terminal: ensayo read-only `COREOPS_EXPECT_SSH_TTY=pts/5`, endpoint autenticado de una API con identidad aislada y Chromium real a 1440 y 375 px. La vista mostró una sesión, proveedor Tailscale, terminal/origen y acción deshabilitada. Los tests rechazan sesiones locales/closing, UID/TTY/scope incorrectos, proceso zombi y ascendencia falsa; prueban ambos formatos de who sin inventar el año. Ocho escenarios UI Security correctos, race de core/adaptador/permisos HTTP y vet/build/formato/fronteras correctos. El ensayo OpenSSH controlado propio siguió identificando y cerrando sólo su conexión. Se limpiaron API/identidad de prueba y se conservó la sesión del usuario. El alcance Tailscale es de terminales activas de consulta, no cierre ni conexiones sin PTY.
