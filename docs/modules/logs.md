# Logs y eventos del host

## Estado y responsabilidades

La vista mantiene el lector inspirado en Dozzle con temas CoreOps, pestañas (máximo ocho), comparación, búsqueda literal/case/exclusión, niveles, JSON expandible, copia/descarga y modo foco. Ahora permite consultar el historial **conservado y accesible** del journal y de archivos de logs; no se limita a las últimas 300 entradas del sistema.

- `frontend/src/views/LogsView.tsx`: fuentes, catálogo de archivos, pestañas y filtros de fecha/unidad.
- `frontend/src/components/LogPane.tsx`: lecturas cancelables, paginación, seguimiento, filtros de página y exportación. Las páginas anteriores quedan congeladas aunque el seguimiento general esté activo. Las pestañas activas se desplazan a la vista en móvil.
- `frontend/src/lib/logs.ts`, `lib/api.ts`, `lib/types.ts`: selección de fuente, DTOs propios, transporte y limpieza lineal ANSI/OSC. Nunca interpretar HTML ni comandos del contenido.
- `backend/cmd/coreops-api/logs.go`: snapshots Docker y agregado compatible. `logs_journal.go`: journal histórico. `logs_files.go`: catálogo y archivos. `logs_events.go`: eventos Docker. Permanecen en el paquete ejecutable actual; no se ha extraído un módulo `internal/`.

## Fuentes y contrato

Todas las rutas de logs exigen **operator o admin**, con sesión vigente antes de acceder al host. `/api/v1/audit` sigue siendo exclusivo de admin; el archivo de auditoría de CoreOps y sus alias por inode quedan excluidos del lector de archivos.

| Consulta | Comportamiento |
| --- | --- |
| `GET /api/v1/logs` | Snapshot reciente de journal + contenedores, hasta 500 entradas. No mezcla archivos/eventos independientes ni ofrece historial agregado. Los fallos de Docker no ocultan un journal legible. |
| `GET /api/v1/logs?source=system` | Journal de todos los boots retenidos y visibles para el servicio. `category=all\|kernel\|services\|security`; `unit=ssh.service` opcional, sin comodines. |
| `GET /api/v1/logs/sources` | Catálogo de archivos de texto y rotaciones `.gz` bajo el directorio de logs. Indica legibilidad y directorios inaccesibles; no eleva privilegios. |
| `GET /api/v1/logs?source=file&file=auth.log` | Archivo confinado a la raíz. Texto normal desde el final hacia atrás; `.gz` desde el principio hacia delante. |
| `GET /api/v1/logs?source=events` | Eventos reales Docker de todos los tipos (contenedor, imagen, red, volumen, etc.) que conserve el motor. Rango inicial: últimas 24 h. |
| `GET /api/v1/containers/{id}/logs?tail=500` | Snapshot stdout/stderr/TTY; tail 1–1000. Conserva el contrato anterior. |

Journal y archivos aceptan `limit=1..1000` y `cursor` devuelto por la página. Se mantiene `{entries,sources,updatedAt,warnings?,truncated?}` y se añade `nextCursor?`, `historyOrder?` (`older`/`newer`). Cada página reemplaza el buffer; no se acumula todo el historial en memoria. `Older entries` / `Next archive page` recorren las páginas; `Return to latest` / `Archive start` reinician la consulta.

Journal y eventos aceptan `since`/`until` RFC3339. El formulario usa hora local y envía el instante UTC. Unidad aplica sólo al journal. Búsqueda y niveles filtran la **página mostrada**; copia/descarga exportan sólo sus líneas filtradas. No hay búsqueda global persistente ni exportación completa automática.

El journal incluye kernel de boots anteriores mediante `_TRANSPORT=kernel` (sin `-k`, que restringiría al boot actual), unidades `.service` y mensajes de su gestor systemd, autenticación (facilities auth/authpriv, sshd/sudo/fail2ban) y transporte audit. El journal completo conserva también otros tipos de evento. Servicios sin unidad explícita se filtran por metadata de unidad/gestor en scans de hasta 1000 registros; una página puede no tener coincidencias y aun así ofrecer cursor. Evita expandir un comodín sobre el índice histórico completo, que resultó demasiado lento en este host.

## Acceso, retención y formatos

El backend utiliza los permisos existentes de su cuenta. No se añade sudo, root, permisos ni grupos automáticamente. Para ampliar cobertura, el administrador del host debe conceder sólo lectura al journal (por ejemplo grupo `systemd-journal`) y a los archivos deseados (ACL/grupo apropiado; `adm` en Ubuntu puede dar acceso amplio), y reiniciar el servicio tras cambiar grupos. Un journal parcial, un archivo bloqueado o un directorio inaccesible se señalan en la UI. No equivalen a ausencia de eventos.

`COREOPS_LOG_ROOT` permite mapear el directorio de logs del host (por defecto `/var/log`; ese es el namespace mostrado). Se admiten nombres de logs estándar y extensiones `.log`, `.err`, `.out`, con rotaciones numéricas/fecha y `.gz`. No se exponen rutas arbitrarias, enlaces simbólicos, dispositivos/FIFO ni formatos binarios (`journal`, wtmp/btmp/lastlog, sysstat). El journal binario se consulta exclusivamente mediante `journalctl`.

No es posible recuperar registros borrados, rotados fuera de retención, nunca registrados o inaccesibles. Docker sólo conserva normalmente sus últimos 256 eventos, incluso si se solicita un rango mayor; se muestra una advertencia. No existe un archivador duradero nuevo de eventos. Journald proporciona los eventos de Linux registrados; no es una captura de cada syscall o acción del kernel.

Timestamps proceden del registro original; los que no se pueden interpretar se muestran como `—`, conservando el mensaje. Las prioridades del journal son reales; niveles de archivos/Docker se infieren cuando no están declarados. El journal muestra fecha además de hora para distinguir días/boots.

## Límites y actualización

Polling de snapshots a los 2 s de cada respuesta; catálogo Docker a 15 s y catálogo de archivos al abrir/actualizar la vista. Se respeta `autoRefresh` inicial y se suspenden lecturas de paneles ocultos. Pause cancela la lectura; los errores conservan el último snapshot marcado como antiguo. Archivos comprimidos, páginas anteriores y rangos con fecha final no hacen polling.

Lecturas de logs: hasta cuatro solicitudes concurrentes, deadline general 12 s; archivos/eventos hasta 10 s dentro de ese plazo. Journal/texto: ventanas de 2 MiB; mensajes de hasta 64 KiB. Páginas journal demasiado grandes fallan explícitamente: reducir tamaño/rango. Archivos normales tienen cursor de offset + identidad de dispositivo/inode; reemplazo o reducción detectados devuelven 409. El lector gzip mantiene memoria acotada, verifica el stream y repite descompresión hasta el offset de la página, con deadline; archivos grandes/profundos pueden superar ese plazo. No se genera un índice persistente.

Descubrimiento: hasta 5000 entradas recorridas, 2000 archivos y profundidad ocho, con advertencia si se alcanza el límite. El acceso HTTP a un nombre válido confinado sigue disponible aunque no se haya enumerado. Cada pestaña guarda sólo un snapshot en memoria; caché máxima 16, eliminada al cerrar su fuente/logout/desmontaje. Logs tiene su propio Suspense para conservar PTY abiertas.

## Validación

Desde backend: `go test -race ./...`, `go vet ./...`, `go build ./...`. Desde frontend: `pnpm format:check`, `pnpm build`, `pnpm test:ui` (45 pruebas).

`logs_host_test.go` cubre cursores y filtros journal, acceso parcial, mensajes binarios JSON, scans de servicios, recorrido completo de 1200/10000 líneas, rotación, confinamiento/symlinks/FIFO, gzip/cancelación, eventos Docker finitos, roles/revocación y protección de auditoría. `host-logs.spec.ts` cubre paginación congelada, filtros de fecha/unidad, archivos/archivos comprimidos, permisos y 320px. Se conservan pruebas de lectura Docker, XSS/ANSI/OSC y persistencia de terminal.

Validación real en este Ubuntu mediante una API aislada y usuario operator temporal: páginas recientes/anteriores de journal/kernel/servicios/auth sin duplicados, 165 archivos descubiertos (155 legibles, cuatro avisos de directorios), syslog/auth/kernel/UFW/dpkg, gzip contrastado con el archivo original y 256 eventos Docker. Chromium verificó catálogo, historial journal, archivo UFW y eventos a 320px sin errores de ejecución. Estos recuentos son evidencia de esta prueba, no datos fijos del producto. No se modificó infraestructura ni se compiló Android/iOS.
