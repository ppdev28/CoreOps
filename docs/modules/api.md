# API: contrato y transporte

## Responsabilidad

Mantener la frontera HTTP/JSON para web y móvil: rutas, autenticación/autorización, validación de entrada, DTOs, errores y semántica de acciones. El contrato inicial ya vive en [`api/`](../../api/README.md); handlers/DTOs de contenedores en [`backend/internal/transport/httpapi/`](../../backend/internal/transport/httpapi/README.md). Health/auth/contenedores están documentados; las demás capacidades se incorporarán gradualmente.

`routes.go` es el inventario ejecutable de métodos y roles; [estado actual](../current-state.md) lo resume. `http.go` conserva aliases JSON y CORS/logging; `handlers.go` aún contiene handlers legacy. Contenedores ya separa transporte, casos de uso y adaptador Moby. Todas estas rutas pertenecen al mismo proceso Go.

La [terminal](terminal.md) añade `GET /api/v1/terminal/session`: upgrade WebSocket y auth admin en el primer frame antes de arrancar la PTY. No usa Bearer en URL. Consultar su guía para protocolo, límites, proxy y caducidad; no tratar el upgrade como acceso anónimo a una shell.

## Instrucciones

- Mantener `/api/v1` y roles al extraer código. Documentar health/login públicos y todos los demás protegidos, incluido logout.
- Validar targets, cuerpo máximo, tipos y acciones antes del caso de uso; mantener defensa también en el adaptador privilegiado. No pasar opciones arbitrarias del usuario a comandos del host.
- DTOs explícitos, sin tipos Moby. El adaptador de inspect convierte la metadata SDK en valores JSON propios; mantener compatibilidad mientras se completa su tipado.
- Mantener por ahora `{ "error": "..." }`; planificar códigos estables, correlación y errores públicos sin filtrar detalles internos.
- Especificar `null`/ausencia para datos no disponibles. No introducir ceros como sustitutos de mediciones desconocidas.
- Tratar CORS como política del navegador, no autorización. Definir orígenes de producción y confianza del proxy explícitamente.

## Contrato inicial y validación

El contrato inicial captura health, login/logout/me y list/inspect/start/stop/restart de contenedores. Se valida con middleware real, roles, errores y runtime sustituible. Creación, borrado, logs, Compose, Files y Kubernetes conservan sus rutas/contratos documentados y pruebas propias, pero todavía no forman parte de este OpenAPI parcial.

## Creación de contenedores (2026-11-15)

`POST /api/v1/containers` es exclusivo de admin. DTO y validación en `container_create.go`, cliente TypeScript en `lib/api.ts`; contrato, límites y respuesta parcial en [backend README](../../backend/README.md#container-creation). `container_create_test.go` usa middleware real y Moby contra un Engine HTTP falso para probar roles/revocación, traducción de configuración, límites, 400/409/422/502, 201 y fallo de arranque sin duplicar/borrar el contenedor.

## Eliminación de contenedores (2026-11-15)

`DELETE /api/v1/containers/{id}` exige admin y no admite query/body ni opciones de force/volúmenes. Handler: `container_delete.go`; DTO de éxito compatible con acciones `{ok,id}`. `container_delete_test.go` verifica políticas/revocación, CORS, opciones SDK seguras, 400/403/404/409/502, éxito y auditoría con middleware/Moby reales contra un Engine HTTP de prueba. [Contrato y límites](../../backend/README.md#container-deletion).

## Logs dirigidos y journal (2026-11-15)

`GET /api/v1/containers/{id}/logs?tail=500` y `GET /api/v1/logs?source=system` usan el mismo mínimo operator de `/logs`. DTOs aditivos, límites, errores y semántica de snapshots documentados en [Logs](logs.md). Conservar `Cache-Control: no-store`, cancelación y timestamps reales; no sustituir fallos de fuentes por estado vacío saludable.

## Historial y fuentes del host (2026-11-15)

`GET /logs/sources` y `GET /logs?source=system|file|events` mantienen operator/admin. Journal: categoría/unidad/fecha y cursor entre boots retenidos; archivos: raíz confinada, texto y gzip paginados; eventos: buffer finito Docker. `nextCursor` y `historyOrder` amplían el DTO compatible. El agregado conserva su snapshot de journal/contenedores y los archivos/eventos se consultan como fuentes separadas. CoreOps audit conserva su endpoint admin. Consultar [contrato y límites completos](logs.md), incluidos permisos, rotación, scans de servicios y descompresión.

## Creación Compose (2026-11-15)

GET `/compose`, POST `/compose/validate` y `/compose/projects` son admin. Preview con hash y servicios, creación sólo de proyecto nuevo, DTO propio con inventario real y 201/202 parcial explícito. [Contrato/límites](compose.md). No sustituir este flujo por comandos o YAML arbitrarios; preservar los rechazos previos al CLI y los errores sin contenido sensible.
