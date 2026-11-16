# Actualizaciones del sistema

## Qué se corrigió

La implementación síncrona ejecutaba `apt-get` como el usuario del servicio y
reintentaba con sudo tras cualquier fallo, ocultando la salida útil. En este host
el servicio corre como `pepe` y `sudo -n` exige contraseña. Además, la operación
podía durar 20 minutos, frente a `WriteTimeout=45s` del servidor HTTP: el cliente
podía perder la respuesta aun cuando APT siguiera trabajando.

Se mantienen GET `/api/v1/updates` para viewer y POST `/updates/refresh|apply` para
admin. Ahora los POST devuelven **202** con un trabajo y `Location`; consulta admin
`GET /api/v1/updates/jobs/{id}` y `/current`. La UI hace polling, conserva el trabajo
al navegar/recargar, bloquea duplicados y muestra resultado/error/salida reales.
Ninguna mutación se reintenta automáticamente. El mismo proceso acepta sólo un
trabajo, y APT conserva sus locks frente a otros procesos.

Los trabajos se conservan **en memoria** (16), no son un historial durable. Si se
reinicia la API, un job anterior puede no estar disponible y el proceso APT puede
seguir activo; comprobar el estado de APT/dpkg antes de reintentar. No afirmar éxito
por una pérdida de conexión. Auditoría: aceptación HTTP y evento terminal `JOB`,
con actor, acción y resultado, sin salida de consola ni secretos del entorno.
Un fallo al volver a leer la lista tras una operación correcta se muestra como
warning; no solicita repetir una actualización ya aplicada.

GET representa el índice local, no una comprobación remota de repositorios.
`updatedAt` es la lectura de ese índice. Incluye `capability.available/error` para
explicar permisos del servicio; se cachea 30 s. Rol local insuficiente es 403;
helper/privilegio del servicio no disponible es 503, trabajo concurrente 409,
petición inválida 400 y trabajo desconocido 404. Un fallo aceptado aparece como
`status=failed` y error/output en el job. Sólo admin puede ver resultados de trabajos.

## Habilitar APT con privilegios acotados

El código y la plantilla están preparados, pero **no se ha cambiado sudoers en el
servidor**: el usuario actual no tiene sudo no interactivo. No usar Docker ni otro
servicio privilegiado para eludir ese límite. Revisar estos artefactos:

- [Helper](../../deploy/coreops-packages): acciones `check`, `refresh`, `apply` y
  `upgrade`; argv validado, máximo 100 paquetes, sin opciones/caminos arbitrarios.
- [Instalador](../../deploy/install-updates-helper.sh): instala el helper root:root
  0755 y una regla exclusiva validada con `visudo`; no instala paquetes.
- [Plantilla sudoers](../../deploy/coreops-updates.sudoers).

Desde la raíz del repo, una persona con sudo ejecuta **una vez**:

```bash
sudo sh deploy/install-updates-helper.sh pepe
```

`pepe` es la cuenta del proceso de desarrollo inspeccionado. Para la unit de
producción usar su usuario real (por defecto `coreops`). El helper queda en
`/usr/local/libexec/coreops-packages`, la regla en `/etc/sudoers.d/coreops-updates`.
El backend comprueba propiedad root y ausencia de permisos de escritura de grupo/
otros tanto en el helper como en sus directorios. No se concede acceso directo a
`apt-get`, `sh`, `env`, `install` ni `ALL`. Permitir gestionar paquetes del sistema
sigue siendo un privilegio elevado: los scripts de paquetes se ejecutan como root.

Comprobar sin actualizar nada, desde la cuenta del servicio:

```bash
sudo -n -- /usr/local/libexec/coreops-packages check
```

Debe devolver `coreops-packages ready`. Esperar hasta 30 s y recargar la vista, o reiniciar la API, para
renovar la comprobación cacheada. Después usar **Check now** y seleccionar los
paquetes, revisando la confirmación obligatoria. Las actualizaciones pueden
reiniciar servicios; los ensayos automatizados no actualizan el host real.

El helper usa entorno mínimo, locale C, `DEBIAN_FRONTEND=noninteractive`, conserva
configuraciones existentes con `--force-confdef/--force-confold`, espera locks hasta
15 s y tiene deadline de 20 min. `NEEDRESTART_MODE=l` lista los procesos que podrían
necesitar reinicio; los scripts de cada paquete aún pueden reiniciar servicios.
Un fallo de repositorios con `APT::Update::Error-Mode=any` no se presenta como una
actualización completa. Los timeouts/interrupciones requieren comprobar dpkg;
no ejecutar reparación forzada automáticamente.

## Validación

Tests Go cubren sesión/roles, inputs, un único trabajo, desconexión del request,
resultado/salida, fallo de permisos, entorno sin secretos y auditoría final.
El helper se prueba como root dentro de un contenedor desechable sin red y sin
capabilities, con `apt-get` sustituido por un stub: valida argv, rechazos, entorno
y acciones, sin instalar paquetes. Sintaxis shell y sudoers se validan aparte.
Playwright cubre el trabajo al navegar, polling, resultado, bloqueo y falta de
privilegios. El host sólo se consulta con `apt list --upgradable`/preflight; no se
han aplicado actualizaciones reales, porque podrían afectar servicios del usuario.
