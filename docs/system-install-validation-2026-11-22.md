# Servicio y APT: validación — 2026-11-22

## Alcance

Rama develop confirmada, entrega previa conservada sin commit. `.deb` con Go/web,
cuenta dedicada, configuración/state privados, helpers versionados y setup de
migración. APT propio firmado elegido por el usuario; generador local y cliente
con fingerprint/Signed-By/pin, sin publicación. Se retira el deploy SSH/reset-hard
legacy; CI/packages cubren main/develop, artefactos sin firma/publicación remota.
Guía completa: [instalación](installation.md).

## Evidencia

- Go `go test -race ./...`, vet y build correctos. Tests nuevos de archivos web,
  symlink/traversal/ocultos/listados, métodos, cache y frontera API/métricas.
  El health Docker anterior conserva su contrato; liveness/versión independiente.
- systemd-analyze verify correcto con ExecStart sustituido sólo durante validación
  por un ejecutable disponible, ya que no se instala en el host. Emitió avisos
  de units ajenas (PIDFile legacy de ajenti y CPUAccounting de xfs_scrub), no de
  CoreOps. AST/YAML/enlaces locales y diff check correctos.
- 26 pruebas Python correctas: ocho setup nuevas (incluida terminación pidfd de un
  proceso API desechable propio), cinco de energía y trece Security/Tailscale ya
  existentes. Shell syntax de scripts maintainer/helpers correcta.
- Construcción e inspección amd64/arm64: versión 0.1.0~dev20261122, assets incluidos,
  root:root, permisos, conffile privado, scripts ejecutables, sin state/.env de
  desarrollo, sin archivos bajo /usr/local en el payload. Source/build-info marca
  dirty porque contiene los cambios aceptados sin commit. Arm64 no ejecutado.
- APT real en directorios temporales: clave ed25519 desechable, InRelease válido,
  candidato visible, simulación de instalación correcta, descarga con SHA256 igual
  al `.deb` y rechazo de firma modificada. Incluye índices por hash SHA256/SHA512;
  no se escribe configuración/cache/listas del APT del host ni se instala nada.
  Test reproducible: `python3 scripts/test-apt-repository.py dist/packages/*.deb`.
- Contenedor descartable desde imagen Ubuntu existente: APT resuelve dependencias,
  instala/reinstala paquete, mantiene hash de users.json y conserva identidad tras
  remove/purge. No usa Docker socket, PID namespace ni filesystem raíz del host.
- Segundo contenedor con permiso ptrace **limitado a sus procesos**: identidad,
  sesiones, clave de Terminal, copy/owners, sudoers real, fallo de arranque inducido,
  rollback del API anterior y posterior arranque API como coreops correctos.
  MainPID/inode/versión y sesión conservada verificados. systemctl fue un stub del
  contenedor: no representa una prueba real de systemd PID 1 ni se ejecuta power.
  Script `scripts/smoke-packaged-install.py` rechaza ejecución fuera de ese entorno.
- API/web extraídas del paquete en proceso aislado con identidad temporal: login
  real desde Chromium a 320/1440 px, Security y assets, sin errores JS/desbordamiento
  ni POST de energía. Usuarios anónimos 401; index no-store/assets immutable.
  Sin Vite/proxy y sin credenciales reales. Identidad/procesos retirados.

## Incidencias corregidas durante validación

El primer staging conservaba permisos group-write de assets Vite; la inspección
los rechazó y el builder ahora normaliza permisos del payload. Un ensayo APT
reutilizó InRelease con HTTP 304 del mismo segundo: se fuerza una descarga nueva
en el test de alteración antes de afirmar rechazo. APT prefería by-hash SHA512 y
se añadió junto a SHA256 para evitar fallback al índice mutable. Un ensayo web
construía literalmente /./assets; el cliente de prueba usa resolución URL real,
y el build de paquete utiliza base / para rutas de navegación.
La comprobación de metadata detectó que apt-ftparchive ignoraba su opción
Valid-Until: el generador añade ahora explícitamente esa cabecera antes de firmar.

Una repetición de contenedor falló por mirrors HTTP temporalmente inaccesibles;
se repitió con mirrors oficiales HTTPS y Error-Mode=any, sin desactivar TLS/firmas.
La lectura root de /proc del usuario fuente dentro de Docker necesitaba ptrace;
se concedió sólo en ese contenedor aislado, nunca contra procesos del host.
Debconf en contenedor informó de ausencia de TTY y utilizó modo no interactivo;
el paquete CoreOps no pidió secretos desde scripts maintainer.

## Artefactos y límites efectivos

Paquetes privados en `dist/packages/` (ignorados por Git), logs:
`/tmp/coreops-package-build.log`, `coreops-package-arm64.log`,
`coreops-packaging-go-race.log`, `coreops-package-container.log`,
`coreops-service-migration-validation.log`, `coreops-signed-apt-test.log`,
`coreops-package-web-review.log`. Capturas privadas del primer ensayo web:
`/tmp/coreops-package-web-review-l88r4qbd/`.

No se ha instalado el servicio en este host ni cambiado cuenta/grupos/sudoers/red/SSH/
paquetes del host. El API/tmux existente sigue activo; la migración real necesita
que el administrador ejecute el instalador con sudo interactivo. Validar después
MainPID, URL/bind, login, permisos de cada integración y TLS. No se ha probado
reboot real, dispositivo/APK, arm64 nativo, downgrade histórico ni restore de una
base migrada sobre datos más nuevos. No hay dominio/clave de firma de producción,
licencia de redistribución elegida, publicación APT, workflow remoto, commit o push.

Purge conserva state, backups/credenciales y cuenta; dpkg sí retira su conffile env.
No borrar claves/audit al limpiar. El perfil no instala agentes/sensores ni hace
que un usuario dedicado pueda leer/señalizar cualquier proceso/archivo del host.
Docker/Terminal/helpers conservan los riesgos y límites del registro global.
