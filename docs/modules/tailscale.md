# Tailscale en Settings

## Responsabilidad y contrato

Settings → Tailscale gestiona el daemon del **servidor CoreOps**, no la app VPN del
móvil. Sólo admin puede consultar o cambiarlo; viewer/operator no ven la sección.
`internal/tailscale` contiene el modelo y el flujo; `adapters/tailscalelocal` habla
con el socket Linux fijo `/var/run/tailscale/tailscaled.sock`. `cmd/coreops-api`
compone permisos, HTTP y audit. El navegador nunca accede al daemon/socket/CLI.

GET `/api/v1/tailscale` devuelve estado/version, hostname/boot ID del host, ID de
nodo, IP/DNS/tailnet, avisos, preferencias disponibles, permisos y hasta 500 peers
visibles. No es un inventario de todo el tailnet: depende de su política. Un estado
online desconocido queda null, no offline. Fallar preferencias no inventa valores
ni impide mostrar el estado disponible. No se devuelven claves ni preferencias
raw. Respuestas no-store/private, tamaño upstream máximo 2 MiB, máximo dos lecturas
HTTP simultáneas y deadlines acotados. No se siguen redirects ni proxies del entorno.

POST a la misma ruta recibe JSON estricto de hasta 8 KiB:

- action: connect, disconnect, configure o login.
- hostname: nombre real del host escrito en la confirmación.
- revision: hash del snapshot revisado (64 hex).
- requestId: 32 caracteres hexadecimales; sin tokens en URL.
- changes: sólo hostname (0–63 caracteres de etiqueta DNS), acceptDNS, acceptRoutes,
  ssh y shieldsUp. Sólo configure acepta cambios; las demás acciones exigen {}.

El backend vuelve a consultar estado/permisos, compara identidad/versión, revalida
la sesión admin y persiste intención de auditoría con fsync antes de despachar.
Fallo de auth/audit impide ejecutar. Hay una sola mutación a la vez, cooldown de
5 s y deduplicación por sesión/JSON durante 5 min, máximo 64 recibos en memoria.
Se conservan resultados inciertos para no ejecutar una misma solicitud dos veces.
Sin garantía durable tras reinicio/caducidad ni exclusión transaccional de otros
clientes/CLI. HTTP 202 significa aceptación, no convergencia de la red.

Se usa PATCH con MaskedPrefs: sólo los campos explícitos tienen su marcador Set.
No se restablecen exit node, rutas anunciadas, Serve, Funnel, ACL, operator o
netfilter. Disconnect cambia WantRunning y conserva la identidad, sin logout ni
borrado de claves. Connect sólo reconecta un perfil autenticado detenido. Login
sólo se permite en NeedsLogin y prepara el flujo interactivo; no fuerza reauth de
un nodo conectado. No se reciben auth keys/passwords Tailscale en CoreOps.

Las URLs de login son efímeras: sólo HTTPS en login.tailscale.com o el mismo origen
HTTPS del control plane configurado. Sólo se muestran si necesita login, no se
registran en audit ni se persisten en preferencias del navegador. El enlace a la
consola oficial sólo aparece con control plane oficial. Headscale conserva su
origen de login; no se inventa una consola de administración para él.

## Interacción y permisos del host

La página muestra la conexión, nombres/IP largos sin desbordamiento, rutas/exit
node de consulta y dispositivos con búsqueda/filtro/Show more. Cambios sólo tras
Review y confirmación escrita del hostname. Se advierte que DNS/rutas/bloqueo/SSH
o desconexión pueden cortar el acceso; disponer de consola u otra vía. No se
reintentan mutaciones automáticamente. La UI refresca y verifica las preferencias
que vuelva a observar; una pérdida de respuesta no se presenta como éxito.
Una edición pendiente que diverge de un nuevo snapshot exige Reload preferences.
Un fallo de lectura mantiene los datos anteriores identificados como obsoletos y
bloquea acciones. Save/Reset de preferencias locales no se aplican a Tailscale.

El socket puede ser legible sin permitir editar. Se comprueba con POST check-prefs,
que sólo valida, sin aplicar. Si la cuenta ya tiene permisos del daemon, se usan
sin elevar. En caso contrario, una persona con sudo puede instalar el helper
restringido, revisando primero los archivos:

```sh
sudo sh deploy/install-tailscale-helper.sh pepe
```

Sustituir pepe por la cuenta real del API. Instala root-owned 0755
`/usr/local/libexec/coreops-tailscale` y sudoers con dos argv exactos: check/apply.
Python 3 aislado, stdin máximo 8 KiB, allowlist independiente y socket root-owned.
No concede sudo genérico, un proxy de LocalAPI o todos los permisos de operador
Tailscale. Instalar no conecta/desconecta, inicia login ni cambia preferencias.
Refrescar la vista después de instalar. No eludir sudo con Docker ni usar una
contraseña CoreOps como credencial del sistema. Daemon ausente: instalar/iniciar
Tailscale mediante la operación normal del host, fuera de este endpoint.

## Validación

`go test -race ./...`, vet/build; `python3 -B -m unittest discover -s deploy -p
 test_tailscale_helper.py`; shell syntax del instalador. `tailscale_test.go` prueba
roles, revocación, audit fallido, precondiciones y replay; tests de núcleo/adaptador
cubren schema, máscaras, desconocidos, límites y URLs. El helper se importa con
sus llamadas simuladas: nunca probar apply con el daemon real.

Playwright `tailscale-settings.spec.ts` recorre Settings a 320/390/768/1024/1440 px,
confirmación/cancelación, cambios parciales, permisos, login, peers, datos obsoletos
y errores sin retry. La adaptación móvil usa navegación horizontal, hit areas
44 px, campos apilados y cabecera de guardado local visible. No requiere cambios
en Kotlin ni demuestra por sí sola comportamiento de un dispositivo físico.

En el host de integración se observó Tailscale 1.104.7; el API local no garantiza
estabilidad de todos los campos entre versiones. Mantener DTOs propios, estados
unknown/partial y pruebas al actualizar Tailscale. No cambiar preferencias o
interrumpir la conexión real del usuario para comprobar la función.

Referencias primarias: [CLI y semántica de set](https://tailscale.com/docs/reference/tailscale-cli),
[handlers LocalAPI](https://github.com/tailscale/tailscale/blob/main/ipn/localapi/localapi.go),
[cliente oficial](https://github.com/tailscale/tailscale/blob/main/client/local/local.go).
