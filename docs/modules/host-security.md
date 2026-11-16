# Security del host

## Implementación y límites

`backend/internal/security` posee comprobaciones basadas en evidencia y acciones verificadas; depende de un puerto `Source`, sin HTTP, comandos ni SDK. `internal/adapters/linuxsecurity` recoge Linux/procfs/systemd/UFW/OpenSSH/fail2ban/journal. `cmd/coreops-api/security.go` adapta HTTP y conserva roles: operator/admin para consultar; sólo admin para modificaciones. La UI sigue en `views/SecurityView.tsx`; no se presenta como un feature frontend ya extraído.

No es un escáner de vulnerabilidades ni una certificación. Sólo revisa la configuración global de OpenSSH (`sshd -T`); reglas Match, otro archivo de configuración o un daemon distinto pueden diferir. `PermitRootLogin prohibit-password` permite claves de root y no equivale a `no`. Autenticación interactiva puede ser MFA legítimo. Un socket escuchando no demuestra exposición externa. UFW activo no garantiza que todas sus reglas sean adecuadas. fail2ban debe responder y tener alguna jail; esto tampoco demuestra cobertura completa.

Actualizaciones automáticas requieren política efectiva APT periódica para listas/unattended-upgrade y `apt-daily-upgrade.timer` activo y habilitado persistentemente. El servicio unattended-upgrades por sí solo no programa actualizaciones. La acción sólo habilita/inicia ese temporizador y verifica el resultado; no modifica política ni ejecuta un upgrade manual. El siguiente disparo del temporizador sí puede instalar paquetes según la política existente.

## Sesiones SSH

Se enumeran procesos OpenSSH autenticados, con usuario, UID, terminal(es) real(es), PID/padre, ID estable derivado de boot ID/PID/start ticks y logind ID cuando existe. `notty` identifica conexión sin PTY. Origen y hora proceden de utmp/logind; el peer TCP puede aportar el origen. Un dato no accesible se representa como no disponible. `who -u` sólo enriquece un candidato SSH coincidente: su año no es un PID. Un registro local o logind en closing no crea una sesión SSH. También se muestran terminales de **Tailscale SSH** cuando coinciden el registro utmp, un logind remoto en estado active/online, usuario/UID/TTY/scope y la ascendencia real shell → login → `tailscaled be-child ssh-monitor` → daemon root de `tailscaled.service`. No basta una shell local, un nombre de proceso ni una IP Tailscale. Los registros closing y procesos zombis no crean sesiones. Tailscale sin PTY o conexiones sólo de forwarding quedan fuera de este inventario; no se afirma cobertura de otros servidores SSH.

Terminar una sesión **OpenSSH** requiere rol admin, revisión explícita, PID e ID coincidentes con inventario fresco, ejecutables OpenSSH confiables del proceso y padre y permiso real de señalización. Se bloquean PID 1, CoreOps y sus ancestros. `pidfd_open` y `pidfd_send_signal(SIGTERM)` evitan señalar un PID reutilizado; se vuelve a verificar la identidad después de abrir el descriptor. Sin pidfd/permisos no hay fallback a kill numérico ni sudo. HTTP 202 sólo significa señal solicitada: la UI confirma cierre cuando un inventario completo posterior ya no contiene esa identidad. Los canales del mismo proceso pueden cerrarse juntos. Las sesiones Tailscale detectadas son de consulta: no se envían señales al daemon/monitor ni a la shell del usuario y no se concede sudo adicional. La auditoría conserva recurso/identidad/resultado HTTP sin claves ni comandos del usuario.

## Permisos y operación

Fuentes independientes informan `ok`, `partial`, `permission_denied`, `unavailable` o `error`. Fallar la lectura no se convierte en inactive, cero sesiones ni ausencia confirmada de eventos. Los comandos usan argv fijo, entorno mínimo, deadline de 4 s y límite de salida; un overview tiene deadline de 12 s y máximo dos recogidas simultáneas. Se mantienen datos anteriores ante errores de refresco y se bloquean acciones con esos datos antiguos.

La cuenta del API debe poder ejecutar herramientas estándar y leer procfs. Restricciones hidepid, contenedores sin namespace del host, journal y archivos de configuración pueden limitar evidencia. No ejecutar CoreOps entero como root para corregir una tarjeta.

Helper **opcional**, no instalado automáticamente:

```sh
sudo ./deploy/install-security-helper.sh pepe
```

Sustituir pepe por la cuenta real del API. Instala root-owned `/usr/local/libexec/coreops-security` y sudoers con tres argumentos exactos: `ufw`, `sshd`, `fail2ban`; son consultas. Sólo se usa si la consulta directa devuelve permiso denegado. No permite editar firewall/SSH, ejecutar comandos libres ni terminar procesos.

Si el administrador decide permitir la acción de temporizador, reinstalar explícitamente:

```sh
sudo ./deploy/install-security-helper.sh pepe --allow-auto-updates
```

Este permiso adicional sólo autoriza `enable-auto-updates`. Instalar no cambia servicios. Ejecutar después requiere CoreOps admin y confirmación. Se conserva la política de sudo del host. Para journal, revisar por separado acceso de la cuenta al journal del sistema; pertenecer a systemd-journal concede lectura amplia, no sólo esta pantalla. No se concede aquí.

## Validación

```sh
cd backend
go test -race ./...
go vet ./...
go build ./...
# Opcional: servidor SSH propio, loopback, claves temporales; nunca sesiones existentes.
COREOPS_TEST_OWNED_SSH=1 go test -race ./internal/adapters/linuxsecurity -run TestOwnedSSH -v
cd ../frontend
pnpm build
pnpm check:boundaries
pnpm format:check
pnpm test:ui
```

Tests cubren permisos HTTP, auditoría, identidad caducada, PID arbitrario, parsers de configuración/proc/utmp, errores de fuentes y adaptación móvil. El ensayo SSH opt-in requiere Linux/OpenSSH y una cuenta no root; usa una conexión sin PTY para funcionar sin escritura privilegiada de utmp; las terminales pts se prueban también en parser y UI. No altera el daemon instalado ni su configuración. Un fallo de preparación debe investigarse, no convertirse en éxito simulado.

Limitaciones: no inventar historial de sesiones/incidentes ni certificar configuración por usuario; no es auditoría completa del journal. Las identidades siguen el proceso OpenSSH, no cada canal multiplexado. Las acciones conservan la auditoría existente, con sus límites de persistencia/retención. Ver [registro de seguridad](../security.md).


## Corrección de detección Tailscale / locales — 2026-11-16

La sesión real del Mac entraba por Tailscale SSH y no generaba procesos sshd. Se añadió su detección de terminales mediante evidencia cruzada, sin cambiar permisos ni cerrar esa conexión. `loginctl show-session` usa un argumento `--property` por campo: la lista separada por comas devolvía una respuesta vacía en el Ubuntu real. Sólo se consultan IDs derivados de los scopes de candidatos vivos, en una llamada acotada, evitando enumerar sesiones closing antiguas.

`who -u` en el entorno mínimo LC_ALL=C devuelve `Nov 16 HH:MM`, con PID en una columna distinta al formato ISO. El parser reconoce ambos formatos, no trata el año como PID y no inventa el año ausente: la fecha completa procede de logind. Pruebas de regresión cubren los formatos, metadatos, proveedor, ascendencia, sesiones locales/stale y acciones deshabilitadas. El ensayo `COREOPS_EXPECT_SSH_TTY=pts/N go test -race ./internal/adapters/linuxsecurity -run TestReadOnlyLiveTailscaleTerminal -v` sólo lee una terminal existente; nunca le envía señales.
