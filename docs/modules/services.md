# Servicios del sistema

## Estado y contrato — 2026-11-23

`services.go` conserva inventario/inspect de systemd de sólo lectura;
`service_actions.go` implementa las tres acciones y
`internal/adapters/linuxservices` invoca `deploy/coreops-services`.
El navegador sólo habla con la API; nunca ejecuta systemctl ni recibe sudo.

`GET /api/v1/services` requiere viewer y añade `management: {available, reason?}`
por unidad. La disponibilidad es preliminar: combina el permiso del helper con
protecciones conocidas del inspect; los archivos se verifican de nuevo al actuar.
Si falta instalación/permisos, se conserva el inventario con acciones deshabilitadas
y explicación. Filas fallidas se leen con `list-units --plain`, sin perderlas por
el marcador de fallo de systemctl.

`POST /api/v1/services/{name}/{start|stop|restart}` conserva operator/admin y la
respuesta 200 `{ok, name, action}`. Sólo acepta `.service` simple ASCII hasta 255
caracteres, sin rutas/globs/opciones/query, y cuerpo vacío u objeto vacío acotado.
Revalida sesión/rol/expiración bajo bloqueo persistente de identidad y registra
intención durable antes de ejecutar; revocación o fallo de audit impiden despacho.
Una única mutación simultánea (409 si ya hay otra), sin cola ni reintento automático.
La UI confirma Stop, evita doble envío, reconcilia después del éxito y muestra
los errores aunque las notificaciones estén deshabilitadas. Viewer sólo consulta.

## Permisos y límites

La cuenta dedicada `coreops` no tiene autorización polkit interactiva. No se
concede sudo genérico para systemctl: sólo dos comandos exactos del helper
root-owned, `check` y `apply`, habilitados mediante la capacidad `services`.
`apply` recibe JSON estricto por stdin, no acepta opciones CLI adicionales, valida
la unidad canónica contra el manager y sólo ejecuta start/stop/restart síncronos.
Comprueba fragmento, fuente SysV y todos los drop-ins: archivos y directorios
canónicos deben pertenecer a root y no permitir escritura de grupo/otros.
Rechaza unidades transitorias/no cargadas y protege `coreops.service` y unidades
de energía/suspensión de systemd, también mediante alias. CoreOps se administra
desde SSH independiente; la energía se solicita desde su centro de control.

Esto autoriza controlar servicios existentes confiados a root; no es un sandbox
para sus ejecutables ni neutraliza los permisos amplios del grupo Docker.
No habilita/deshabilita/mask/reload, edita units o acepta unidades de usuario.
Lecturas acotadas; helper con deadline total 8 s (metadatos 2 s, acción 5 s),
entrada 2 KiB y salida 8 KiB. Si vence una acción su resultado es incierto: puede
haber quedado un job en systemd. No se afirma éxito ni se reintenta; refrescar y
examinar la unidad antes de repetir. HTTP 400 validación, 403 permiso/protección,
404 unidad inexistente y 503 infraestructura/audit/resultado incierto.

## Activación

En instalación empaquetada actualizada:

```sh
sudo coreops-setup --add services
```

`--add` une capacidades con las guardadas, sin reemplazar el resto ni migrar
usuarios, sesiones o claves. `--enable` sigue reemplazando la selección; ambos
son excluyentes. Setup reinicia CoreOps: ejecutar desde SSH independiente, fuera
de Terminal/Updates de la aplicación. Si el paquete aún no incluye el helper,
seguir el comando de actualización de [instalación](../installation.md).

Sólo para una API compilada desde fuente que usa `/usr/local/libexec`:

```sh
sudo sh deploy/install-services-helper.sh CUENTA_UNIX_DE_LA_API
```

No utilizar este instalador para la cuenta del paquete: sus rutas son diferentes.
La instalación del helper fuente no arranca/detiene/reinicia ninguna unidad.

## Validación

Go race: rol/autorización fresca, revocación, audit fallido, concurrencia y logout
serializados, transporte/argv/límites/resultados. Python: input estricto,
protecciones/alias, archivos/drop-ins y deadlines. Playwright: operator/viewer,
confirmación/doble envío, permiso ausente y error persistente a 320/1440 px.
La integración de paquete usa API, usuarios y sudo reales en contenedor descartable,
con systemctl simulado: no equivale a un ensayo de systemd PID 1 real.
No probar deteniendo ALSA ni otros servicios del usuario. Ver
[informe](../services-permissions-validation-2026-11-23.md).
