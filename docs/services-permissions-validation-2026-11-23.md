# Reparación de permisos Services — 2026-11-23

## Causa y entrega

Rama develop; se conserva todo el trabajo anterior sin commit. El servicio real
está instalado como coreops, paquete `0.1.0~dev20261123`, activo. El código legacy
invocaba start/stop/restart directamente como ese UID, sin permiso polkit no
interactivo. La migración había omitido esa capacidad en el perfil de instalación.

Se incorpora capacidad services, helper root restringido check/apply, adaptador
Go y guard de rol/audit; disponibilidad y errores persistentes en UI. Setup añade
`--add` para unir capacidades, sin reemplazar la selección ni repetir migración.
Paquete final: `dist/packages/coreops_0.1.0~dev20261123.1_amd64.deb`.
[Contrato y límites](modules/services.md), [instalación](installation.md).

## Comprobaciones

- `go test -race ./...`, `go vet ./...`, `go build ./...`: correctos. Pruebas
  nuevas de roles, revocación entre check/dispatch, fallo durable de audit,
  concurrencia, logout bloqueado hasta terminar efecto, input, argv, transporte,
  límites y resultado incierto. Logs `/tmp/coreops-services-go-race.log`.
- 36 Python: power/security/tailscale/services/setup correctos. Opt-in de lectura
  real de ALSA verifica Id/LoadState/Transient/fragmento y permisos del filesystem,
  sin ejecutar ninguna acción. También valida symlink no confiable que apunta a
  archivo root. Log `/tmp/coreops-services-python-all.log`.
- Formato, fronteras y build web correctos. Playwright final: **22/22** Services,
  application y operations, con roles/móvil/desktop/confirmación/permiso ausente y
  errores sin notificaciones. Un primer intento falló en dos localizadores del
  test (dialog frente a alertdialog) y una carga dinámica de Dashboard; se
  corrigió el localizador, 6/6 repetidos y después 22/22 completos. No se atribuye
  el fallo de import a una causa de red no demostrada. Log final
  `/tmp/coreops-services-ui-final.log`. Aviso NO_COLOR/FORCE_COLOR del runner.
- Build .deb amd64 e inspección de ownership, modos, payload/helpers, scripts y
  ausencia de secretos correctos; versión nueva distinta al paquete UI anterior.
- Contenedor descartable con API/cuentas/sudo/sudoers reales: migración y rollback
  inyectado existentes, luego `--add services` conserva política y hashes de
  users/sessions/key. HTTP stop/start/restart sobre unidad de prueba →200;
  protección literal y por alias de CoreOps/energía →403, unit escribible →403,
  JSON action enable rechazado, sudo directo para systemctl denegado. Check
  confirma ejecución root real. systemctl está simulado únicamente en ese
  contenedor: **no prueba systemd PID 1 real**. Log
  `/tmp/coreops-services-container.log` (primera pasada) y
  `/tmp/coreops-services-container-final-retry.log` (paquete final correcto).
  Un intento intermedio falló antes de instalar por conexión al mirror
  archive.ubuntu.com (`/tmp/coreops-services-container-final.log`); la repetición
  con us.archive.ubuntu.com y timeout acotado instaló y pasó todo el ensayo.
- Syntax de instalador shell/Python y git diff check correctos. Sin commit/push.

## Estado operativo y paso pendiente

No se ha cambiado configuración/identidad/permisos ni controlado servicios en el
host. `alsa-restore.service` sigue active/exited y CoreOps active/running bajo
coreops. Sudo exige autenticación interactiva; no se reutilizaron credenciales de
CoreOps ni Docker para eludirla. Para activar, desde SSH independiente de CoreOps,
como pepe en el checkout:

```sh
python3 scripts/install-system.py \
  --package dist/packages/coreops_0.1.0~dev20261123.1_amd64.deb \
  --add services
```

Ese paso instala/reinicia CoreOps (cierra sus PTY), conserva la política previa y
no vuelve a importar identidad. Si el paquete nuevo ya está instalado, basta
`sudo coreops-setup --add services`. La comprobación real de acciones sobre systemd
del host queda pendiente de esa activación y de una operación elegida por el
usuario; no detener ALSA ni servicios de infraestructura sólo para probar.
