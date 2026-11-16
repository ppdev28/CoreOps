# Correcciones operativas — 2026-11-16

Trabajo sobre la rama activa `develop`, partiendo del commit `af69725`. Conserva
los cambios anteriores de observabilidad, modularización, terminal y uploads.

## Cambios

- Vite escucha en interfaces y admite `ppserver` / `ppserver.local`, más los IP y
  localhost admitidos por Vite. No wildcard. `/api` y WebSocket conservan Host.
  El nombre debe resolverse en el cliente mediante DNS local/MagicDNS/hosts.
- Sidebar: retiradas reglas duplicadas que forzaban 64 px en tablet incluso tras
  pulsar la flecha. Estado React real, 64/220 px y botón accesible; default compacto
  entre 768–1150 px y expansión manual dentro de ese intervalo.
- Create container de Dashboard abre el formulario real reutilizado, incluido
  Compose, sólo para admin. Refresca datos y permite inspeccionar el resultado.
- Files: DELETE admin por fichero regular, versión de listado/precondiciones,
  confirmación permanente obligatoria, auditoría y permisos OS, sin sudo/recursión.
  [Contrato y límites](modules/files.md).
- Updates: errores de privilegios diagnosticados, entorno/locale controlados y
  salida acotada. Trabajos 202, polling admin, bloqueo de duplicados y resultado
  auditado, desacoplados del WriteTimeout HTTP de 45 s. Helper argv-validado y
  sudoers exclusivos preparados. [Activación y límites](modules/updates.md).

## Verificado

- `go test -race ./...`, `go vet ./...`, build Go: correctos. Focused race tests
  posteriores sobre Files/jobs/permisos/auditoría y nueva compilación correctos.
- Frontend format/build y fronteras: correctos. **95 escenarios web superados**:
  94 directos y un test previo de carga de Dashboard móvil tras reintento; el mismo
  caso pasó después en aislamiento. Doce escenarios de Dashboard/operaciones
  pasaron juntos sin reintentos. Incluye ocho formatos y funciones anteriores.
- HTTP real: `http://ppserver:5173/` 200, health por ese nombre y por
  `http://192.168.1.128:5173` correcto. Host ajeno `untrusted.invalid` recibe 403.
- Chromium real en ppserver, con transporte a una API aislada y datos reales:
  sidebar 64→220→64, creación desde Dashboard contra Docker, comprobada mediante
  inspect como contenedor nuevo **detenido**, y borrado de un archivo propio.
  Se conservó otro archivo de control. Sin pageerror/overflow a 390 px.
- Docker: sólo se creó/eliminó el contenedor único `coreops-ops-check-*` del ensayo;
  se limpiaron sus recursos. Ningún contenedor del usuario fue detenido.
- APT real: listado de 12 paquetes pendientes y capability=false, con causa
  accionable; el POST se rechazó con 503 antes de invocar una mutación. No se
  refrescó ni actualizó el host. Unit/HTTP y UI validan trabajos aceptados,
  desconexión/navegación, resultados, conflictos, permisos y fallos controlados.
- Helper: nueve escenarios root dentro de un contenedor temporal sin red ni
  capabilities, readonly, con apt-get sustituido por un stub. Acciones admitidas,
  argv de paquetes y rechazo de opciones/path/inyección; entorno API excluido.
  `sh -n` y `visudo -cf` correctos. No se instaló ninguna regla en el host.

## Estado del servidor y límite pendiente

API de desarrollo actualizada conservando entorno, directorio y hashes idénticos
antes/después de users/sessions. Binario `/tmp/coreops-operations-api-verified`,
log/PID en `/tmp/coreops-operations-run/`. Vite existente continúa en 5173.
La identidad, archivos, API aislada y contenedor de prueba se retiran tras validar.

La cuenta del proceso es `pepe`: `sudo -n` exige contraseña y no hay helper
instalado. **Updates necesita todavía una instalación root**, preparada para que
una persona con sudo ejecute desde el checkout:

```bash
sudo sh deploy/install-updates-helper.sh pepe
```

Este comando instala únicamente el helper y su regla acotada; no actualiza
paquetes. Esperar hasta 30 s y recargar la vista después para renovar capability.
No se usó Docker para eludir permisos del host. No se probó una actualización
real de paquetes por su impacto sobre servicios. Jobs en memoria, no durables
frente a reiniciar la API; investigar APT/dpkg antes de reintentar si se pierde
el estado. La comparación de versión en Files no es una transacción con escritores
externos; unlinkat sin AT_REMOVEDIR impide borrar directorios. Sin build nativo
Android/iOS ni validación física de los clientes DNS externos.
