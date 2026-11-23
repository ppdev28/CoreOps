# Tailscale y Settings móvil — 2026-11-22

## Alcance

Trabajo en `develop`, sin cambiar de rama. Se conservan los cambios aceptados de
Applications/Network/Terminal/Updates pendientes de commit. Nueva sección admin
Settings → Tailscale para estado y dispositivos reales, conexión/desconexión,
preparación de login interactivo y edición parcial de hostname/DNS/rutas/SSH/
bloqueo entrante. Confirmación escrita, relectura del objetivo, permisos y sesión,
intención de audit durable y deduplicación limitada antes de ejecutar. Sin logout,
API cloud, auth keys, cambios de operator/ACL/Serve/Funnel ni proxy arbitrario.

Settings móvil conserva el diseño y corrige navegación, espacios, campos y
controles táctiles. Pruebas de las ocho secciones a 320/390/768/1024/1440 px y
plataforma Android simulada. Sin cambios Kotlin ni cap sync, APK o prueba física;
los assets nuevos requieren reconstruir/sincronizar y compilar el APK instalado.

## Validación automatizada

- Go: `go -C backend test -race ./...` correcto; tras los últimos guards de
  preferencias incompletas y URL de login obsoleta se repitieron núcleo/adaptador/
  handlers focalizados con race, y `go -C backend vet ./...` / build correctos.
- Web: fronteras, formato y `pnpm --dir frontend build` correctos.
- Playwright: 153/154 correctos en la ejecución completa (4,1 min), incluidos
  los 14 nuevos de Tailscale/Settings. El caso desktop perdió la carga de módulos
  por ERR_NETWORK_CHANGED confirmado en los eventos console de su traza; repetido
  aisladamente con --last-failed: 1/1 correcto (11,4 s). Se cubren los 154 casos,
  sin afirmar una ejecución completa sin incidencias. Una ejecución anterior
  quedó interrumpida; otra reutilizó un servidor huérfano 5176 que desapareció
  (ERR_CONNECTION_REFUSED confirmado en trazas), y se canceló. La ejecución final
  usó CI=true para que Playwright gestionara su propio servidor.
- Avisos del runner: NO_COLOR/FORCE_COLOR y dimensiones cero transitorias de
  Recharts en otros paneles. No se modificaron esos gráficos ni se ocultaron
  errores/timeouts para obtener el resultado.
- Helper: 5/5 tests Python con LocalAPI simulada; `sh -n` del instalador correcto.
  No se ejecutó apply ni el instalador contra el host real.

Los tests nuevos cubren roles/revocación, audit fallido sin despacho, revisión y
hostname, schemas, campos desconocidos, máscaras, concurrencia/replay, timeouts/
respuestas parciales, sanitización/URLs y errores sin reintento automático. La
prueba UI de cambios observa un daemon simulado; no prueba convergencia VPN real.

## Servidor y navegador reales, sólo lectura

API compilada con identidad temporal y Vite aislado, eliminados al terminar.
Login con admin generado, sin usar la contraseña real del usuario. Chromium real
consultó el socket mediante API y verificó estado Running, restricción de escritura,
ocho secciones sin overflow a 320/390 px y vista escritorio 1440 px. Capturas
inspeccionadas: Tailscale, General y Appearance. Cero page errors y cero POST
mutantes a `/api/v1/tailscale`; el browser bloqueaba esas solicitudes si surgían.

Tailscale **1.104.7**, **27 peers visibles** en esta consulta, Tailscale SSH activo.
Las preferencias públicas, estado e ID del nodo coincidieron antes/después. Los
valores volátiles de peers/tráfico no son precondición de operación ni se presentan
como inventario completo del tailnet. No se interrumpió ni modificó la VPN real.

El socket permite lectura para la cuenta API pepe, pero check-prefs devuelve 403.
Ese endpoint sólo valida preferencias, sin aplicarlas. La gestión permanece
correctamente deshabilitada hasta disponer de permisos. Helper limitado preparado,
no instalado porque sudo requiere autenticación local interactiva:

```sh
sudo sh deploy/install-tailscale-helper.sh pepe
```

Instalar no modifica la conexión. Refrescar Tailscale después. No usar permisos
Docker para saltarse esta autorización. Detalles en [guía del módulo](modules/tailscale.md)
y [seguridad](security.md).

Capturas/logs temporales en `/tmp/coreops-tailscale-integration-fezh7gy0/`, directorio
0700; identidad temporal retirada. No versionar capturas con datos del tailnet,
secretos, binarios ni recursos generados.

## Activación del API

API de desarrollo actualizada sólo en tmux `%0` a
`/tmp/coreops-tailscale-runtime-_2hh1cds/coreops-api`, SHA-256 idéntico al binario
probado `/tmp/coreops-tailscale-api`. Entorno/cwd conservados, hashes de users.json
y sessions.json sin cambios y frontend `%1` intacto. Health del proxy 5173: 200;
GET Tailscale sin sesión: 401. Configuración temporal de arranque privada eliminada.
Helper no instalado; no se cambió ni reinició tailscaled.
