# Security del host

## Capacidad actual — 2026-11-22

`internal/security` contiene checks, mutaciones protegidas, postura detallada,
paginación de journal, monitor/correlación y trabajos CVE. Los adaptadores
`linuxsecurity` y `securityscan` poseen la infraestructura; HTTP/roles/audit siguen
en `cmd/coreops-api/security*.go`. El navegador usa DTOs propios y nunca accede
al socket Docker, journal, comandos o archivos del host.

La pantalla conserva su diseño e incorpora cobertura, política SSH contextual,
journal/señales, informes CVE y verificación de auditoría. Operator/admin consultan;
sólo admin inicia acciones/escaneos o restablece el cursor. Audit integrity es admin.
Los endpoints Security emiten Cache-Control no-store/private, incluso en rechazos.
[Entrega y validación](../security-hardening-validation-2026-11-22.md).

## Acciones, identidad y auditoría

Cierre OpenSSH y activación del timer requieren MutationGuard. Tras obtener la
evidencia se adquiere el flock persistente de identidad, se releen sesión/rol,
se guarda intención audit con fsync y se ejecuta la operación acotada bajo ese
bloqueo. Logout/cambio de rol gana antes y deniega, o completa después de una
operación ya autorizada. Error de identidad/audit o expiración impide despachar.
Hay una sola mutación de este servicio a la vez; sin reintentos automáticos.

El proceso OpenSSH se revalida por boot/PID/start ticks y ejecutables confiables,
permiso de señal y pidfd + SIGTERM. Protege CoreOps/ancestros/PID 1; sin kill
numérico, SIGKILL o sudo. HTTP 202 reconoce la solicitud, no prueba cierre: la UI
espera ausencia en un inventario completo posterior. Tailscale SSH sigue de
consulta, sin señales a daemon/monitor/shell. Conexiones Tailscale sin PTY o sólo
forwarding no se inventan a partir de una IP; no se garantiza todo servidor SSH.

Audit usa append privado con flock propio, secuencia/hash SHA-256 de los DTOs,
rotación actual + tres archivos de hasta 8 MiB y verificación antes de intenciones
durables. Los registros legacy conservan estado legacy_partial. No arrancar
escritores antiguos contra el mismo audit después de migrar. La cadena detecta
alteraciones locales de los campos serializados; root/cuenta API pueden rehacerla:
no sustituye un receptor externo append-only. Archivos/lock/alias de backups
mantienen el límite admin de logs y quedan protegidos en Files.

## Evidencia de postura

- UFW: estado/reglas reales, no un certificado de exposición o reglas correctas.
  Se añade inventario nftables con cadenas/hook/policy/número de reglas, incluido
  Docker cuando está presente. Permisos/otros backends pueden impedir verlo.
- SSH: checks globales y GET de evaluación sshd -T -C para usuario Linux, IP y host
  suministrados. Se muestran métodos/AllowUsers/DenyUsers, sin configuración raw.
  No verifica DNS inverso ni la política upstream Tailscale/ACL.
- APT: política periódica + timer persistente, origen security reconocido para la
  distribución/codename observados y revisión de exclusiones. Política incompleta
  queda desconocida; un origen Example:custom no pasa. Panel con motor instalado,
  orígenes/exclusiones, última ejecución/resultado y reboot-required. Programación
  no demuestra que todos los parches estén aplicados; analizar con CVE/Updates.
- fail2ban: jail, fuentes/logpath/journalmatch, regexes, acciones, umbral/tiempos y
  contadores de ban. Consultas incompletas quedan partial; no prueba bloqueo real
  desde otro equipo ni pertinencia de cada regla.
- Sensores: instalación/estado de auditd, ClamAV, Falco, Suricata, Wazuh, osquery y
  checks programados AIDE/malware; timer/último resultado y fecha del archivo de
  firmas cuando son accesibles. Servicio activo no equivale a cobertura probada.

Los comandos tienen argv/entorno fijos, límite de salida y 4 s; nuevas lecturas
HTTP tienen semáforo y deadlines. Fallos no se convierten en inactive/0/healthy.

## Journal y señales

GET `/security/events` admite category all/ssh/tailscale/kernel/audit/auth/sensors,
direction older/newer, cursor opaco validado y limit 1–200. Lee fuentes fijas de
journal, incluidas Tailscale, sudo/auth, kernel/firewall, auditd y sensores.
Forward usa after-cursor y lines=+N: una ráfaga no salta al final perdiendo filas.
History permite recorrer lo retenido sin el antiguo límite de 120 registros.
Fechas/IDs/cursor/fuente son reales; mensajes largos/decodificaciones parciales se
indican. La UI pausa el avance live al navegar historia y conserva páginas ante
un fallo de lectura.

El monitor del proceso principal consulta cada 10 s aunque la vista esté cerrada,
hasta 20 páginas/ciclo y deadline 8 s. Guarda `security-monitor.json` 0600 con
rename/fsync antes de avanzar el cursor; reanuda tras reinicio mientras el journal
retenga ese cursor. Checkpoint corrupto, permisos, registro inválido o fallo de
almacenamiento detiene el avance. Una caducidad de retención exige revisión y
reset admin explícito con reconocimiento de hueco; no se oculta como continuidad.
No borrar el checkpoint para ocultar una incidencia.

Correlación: hasta 2.000 eventos en memoria del proceso; se reconstruye tras un
reinicio, no es un SIEM durable. Detecta grupos de cinco fallos auth/IP en cinco
minutos, denegaciones MAC y avisos de sensores/firmas/integridad. Las señales
conservan IDs de evidencia y fecha. Ausencia de coincidencias no prueba ausencia
de amenazas. Depende de permisos, integridad/retención del journal y sensores
realmente configurados; no implementa captura exhaustiva de tráfico o memoria.

## Escaneos CVE

GET `/security/scans/capabilities` enumera herramienta, identidad host/boot y hasta
100 IDs locales. GET `/security/scans` devuelve hasta ocho trabajos por proceso.
POST admin recibe JSON estricto target/hostname/bootId/requestId; requiere objetivo
actual y guard de sesión/audit. UI pide escribir hostname y revisar. Un trabajo a
la vez, timeout 6 min, cancelación al parar API, sin retry ni persistencia de
trabajos tras reinicio; repetir un requestId retenido con el mismo actor/objetivo
no inicia otro. Un 202 sólo acepta el trabajo.

Trivy se ejecuta con binario/directorios confiables, entorno mínimo y config fija;
sin auth keys, shell, plugins, flags o rutas elegidos desde navegador. Host: copia
privada de metadata distro/dpkg, sin recorrer secretos/home. Image: SHA local
inmutable, sin pull ni acciones de contenedor. Sólo se exportan campos permitidos;
no env/labels/config raw. Inventario no soportado/fallo/timeout no devuelven limpio.

Informe: fecha de escaneo/DB, OS/EOL, paquetes compatibles, pares paquete/advisory,
CVE distintas y pares con fix publicado. Prioriza 1.000 hallazgos por gravedad/fix,
contando todos los recibidos hasta el límite de salida; marca truncamiento.
Incluye versiones de kernel instaladas que pueden no estar cargadas. CVE/fix del
feed necesita triaje con proveedor y disponibilidad APT; no aplicar el campo fixed
como una orden arbitraria. No instala parches ni actualiza imágenes automáticamente.

Instalar **como la cuenta API, sin sudo**:

```sh
python3 -I deploy/install-security-scanner.py
# Configurar en el entorno del API y reiniciar conservando su identidad:
COREOPS_TRIVY_PATH=/home/pepe/.coreops-tools/trivy
COREOPS_TRIVY_CACHE=/home/pepe/.cache/coreops-trivy
```

El instalador usa Trivy v0.76.2 y Go 1.27.4 para construir el módulo autenticado por
Go/SumDB; no añade Trivy al go.mod del proyecto. DB OCI oficial descargada por TLS.
No mezclar permisos root con el cache/binario de la cuenta API.

## Activación privilegiada del host

Helper actualizado de consultas, instalado por un administrador local:

```sh
sudo sh deploy/install-security-helper.sh pepe --allow-auto-updates
```

Sustituir pepe por la cuenta API. Sudoers sólo admite argv exactos de consultas
ufw/sshd/fail2ban/fail2ban-details/sshd-context/nft; `enable-auto-updates` mantiene
su opt-in independiente. Python aislado valida JSON/usuario/IP/host y jails;
salida/deadline acotados, sin comandos libres, edición de reglas o señales sudo.
Instalar no cambia ningún servicio. El API actual no puede eludir sudo interactivo.

Perfil adicional **manual y root** para sensores:

```sh
sudo python3 -I deploy/install-security-protection.py
# Con varias rutas por defecto, especificar la interfaz que se quiere analizar:
# sudo python3 -I deploy/install-security-protection.py --interface INTERFAZ
```

Requiere 3 GiB de RAM/disco disponibles; instala paquetes distro, configura EVE
alert/anomaly/stats en journal, firmas ClamAV y checks diarios de malware/AIDE con
límites de recursos. Crea baseline AIDE sólo si no existe; no aceptar cambios de
integridad sobrescribiendo una base existente. Conserva backups en
`/var/lib/coreops/security-protection/backups`; no es una transacción APT/config.
Un fallo exige revisar servicios/backup y continuar deliberadamente. No cambia
SSH, UFW, Docker o Tailscale. Validar interfaz/rules, firmas, drop counters, timers
y baseline; tráfico cifrado/carga/rutas fuera de esa interfaz limitan la cobertura.
Wazuh/Falco/osquery existentes se integran por evidencia; no se instalan en paralelo
como si varios agentes garantizasen mayor cobertura.

Perfil OpenSSH para `pepe`, **después de comprobar una clave desde el cliente**:

```sh
sudo python3 -I deploy/harden-openssh.py apply pepe
```

Comprueba clave autorizada/directorios, rechaza Match sin revisar, guarda backup,
valida sshd -t/-T y programa rollback de cinco minutos antes de reload. Deshabilita
password/keyboard-interactive/root y exige publickey para OpenSSH. Mantener la
sesión anterior; comprobar un login nuevo y ejecutar el comando keep con token
que imprime el script. Sin keep restaura automáticamente, mientras el host siga
encendido. No hay sudoers/API para aplicar este perfil. Tailscale SSH es separado.

## Validación y límites de despliegue

Go full race/vet/build; tests de revoke/role, audit fallido/tamper/retención/alias,
serialización, cursor/backlog/checkpoint y whitelist de CVE. Ensayo SSH propio
opt-in, nunca conexiones ajenas. Scans reales de host e imagen local sin mutar
infraestructura. Web formato/fronteras/build y suite completa, escritorio/móvil;
no equivale a prueba APK/dispositivo físico. `scripts/security-check.sh` y workflow
security.yml hacen fallar por avisos conocidos; no usar JSON exit 0 de govulncheck
como prueba de ausencia. El backend requiere Go >=1.26.11 y las dependencias web
parcheadas del lockfile. Ver [informe](../security-hardening-validation-2026-11-22.md)
y [registro global](../security.md) para garantías y controles aún ajenos al slice.
