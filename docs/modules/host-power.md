# Centro de control de energía

## Implementación

`internal/hostpower` posee confirmación de identidad del host, capacidades,
serialización, cooldown de 10 s y deduplicación de solicitudes durante 5 min
(máximo 64 registros en memoria). Depende del puerto `Provider`; no conoce HTTP,
autenticación ni comandos. `adapters/linuxpower` consulta logind mediante busctl
y ejecuta exclusivamente poweroff/suspend/reboot con argv fijo, entorno mínimo,
deadline de 5 s y salida limitada a 8 KiB. No utiliza shell ni fuerza operaciones.

`host_power.go` y `routes.go` exponen GET/POST `/api/v1/host/power`, sólo admin.
GET devuelve hostname, boot ID y capacidades efectivas; errores o permisos
insuficientes deshabilitan controles. POST exige hostname/boot ID actuales,
acción permitida y requestId de 32 caracteres hexadecimales, JSON estricto de
máximo 2 KiB. Revalida la sesión antes del despacho y persiste una intención de
auditoría con fsync; si esto falla, no ejecuta. El registro HTTP posterior conserva
el resultado sin contraseñas ni Bearer. La auditoría sigue sin ser inmutable.

HTTP 202 significa aceptación de la solicitud, no finalización. Una desconexión o
un error después de despachar deja resultado incierto. No hay reintentos
automáticos, ni cola persistente, ni garantía de deduplicación tras reiniciar el
API o caducar la ventana. Las acciones respetan inhibidores de systemd.

El helper llama a logind mediante `PowerOffWithFlags`, `RebootWithFlags` o
`SuspendWithFlags`, sin autorización interactiva y con el flag
`SD_LOGIND_ROOT_CHECK_INHIBITORS` (1). Conserva la protección de inhibidores también
como root; no usa force/skip-inhibitors ni reintenta con otro método si falla.
Un logind sin soporte rechaza la operación. La ruta directa sin helper conserva
su comprobación conservadora de systemctl.

`PowerControls.tsx` aparece bajo el usuario en su menú superior derecho. Exige
escribir el nombre del servidor; cancelar no envía una orden. En Android, el
icono de cuenta de la toolbar emite `coreops-control-center` y abre la misma UI
web, ya que la cabecera React se oculta. Las capacidades siguen en Go.

## Instalación opcional de permisos

La cuenta del API puede consultar logind sin privilegios. `challenge`, `no`, `na`
o una consulta fallida no habilitan acciones. No ejecutar todo CoreOps como root.
Para conceder deliberadamente estas tres operaciones a la cuenta del servicio:

```sh
sudo sh ./deploy/install-power-helper.sh pepe
```

Sustituir `pepe` por la cuenta real del API. Instala el helper root-owned
`/usr/local/libexec/coreops-power` y sudoers con cuatro argumentos exactos:
`status`, `poweroff`, `reboot`, `suspend`. Valida sudoers con visudo. Instalar no
realiza ninguna acción de energía. No concede comandos libres ni sudo genérico.
El adaptador sólo acepta un helper regular ejecutable y un directorio padre
root-owned sin escritura para grupo/otros; usa sudo no interactivo. Sin permiso,
conserva las consultas directas y muestra acciones deshabilitadas.

Antes de desinstalar, retirar `/etc/sudoers.d/coreops-power` mediante un
administrador y comprobar sudoers; después retirar el helper. No modificar
inhibidores ni capacidades para simular soporte de suspensión.

## Validación y límites

`service_test.go`, `power_test.go` y `administration_test.go` prueban proveedores
simulados, roles, identidad, revocación, fallo de auditoría, argumentos fijos,
deduplicación concurrente y resultado incierto. Playwright cubre confirmación,
cancelación, permisos, estados deshabilitados y evento Android a 320/1440 px.
Nunca validar enviando una orden al servidor de trabajo. Un build web no valida
el APK, polkit, sudoers instalado ni que el hardware pueda despertar a distancia.

## Corrección Restart — 2026-11-22

Dos POST reales llegaron al helper y devolvieron 503 con intención audit previa.
El helper instalado usaba `systemctl --check-inhibitors=yes`: además de inhibidores,
esa opción comprueba sesiones de otros UID; al ejecutar como root, las sesiones SSH
de pepe se consideran ajenas. El host tenía sesiones tty de pepe, permisos helper
correctos y sólo inhibidores delay observados. La comprobación está documentada
en el [código oficial de systemd v259](https://github.com/systemd/systemd/blob/v259/src/systemctl/systemctl-logind.c#L207-L238).

El helper corregido utiliza la llamada logind anterior: la confirmación de UI ya
advierte del cierre de sesiones; un inhibidor real sigue pudiendo rechazar la
operación. La [definición oficial de flags](https://github.com/systemd/systemd/blob/v259/src/basic/login-util.h)
confirma el bit 1 para la comprobación root. No se amplía sudoers ni se concede
busctl arbitrario a la cuenta API.

Activar desde el repositorio con `sudo sh deploy/install-power-helper.sh pepe`.
No requiere recompilar API o frontend ni reinicia el host durante instalación.
La sesión Codex no dispone de sudo no interactivo para reinstalarlo; mientras
no se ejecute ese paso el helper efectivo sigue siendo el anterior.

`python3 -B -m unittest deploy/test_power_helper.py` verifica cinco escenarios en
una copia privada con ejecutables de prueba: sesiones presentes/delay, tres métodos
permitidos con flag fijo, rechazo de block sin retry/fallback, status sin mutación,
argumentos inválidos y falta de root. Nunca ejecutar acciones reales de energía
para validar esta corrección.

Validado: cinco pruebas Python, shell syntax y diff check correctos; suites Go de
hostpower/linuxpower completas con race y handlers HTTP de energía focalizados
correctos; seis escenarios UI de energía/roles/Android simulado correctos. Sólo
avisos NO_COLOR/FORCE_COLOR del runner. Sin reinicio real, cambio API/web/APK,
instalación root, commit o push.
