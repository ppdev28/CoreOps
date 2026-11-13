# CoreOps API contract

Este módulo describe la frontera entre clientes y backend. **No es otro servidor**: el transporte HTTP se ejecuta dentro del único backend Go. No importar Docker, Linux, React ni lógica de producto aquí.

- `openapi.json`: contrato OpenAPI 3.0.3 inicial de health, login/logout/me y list/inspect/start/stop/restart de contenedores.
- `typescript/containers.ts`: DTOs de contenedores consumidos por el adaptador frontend. Son tipos de wire, sin componentes ni ejecución. Se mantienen manualmente junto al contrato; no se ha introducido un generador ni otro package manager/runtime.
- Resto de `/api/v1`: implementado pero aún fuera de este contrato parcial. La terminal mantiene su [protocolo WebSocket](../docs/modules/terminal.md).

## Cambios

Leer `docs/modules/api.md`. Conservar URLs, casing, nulabilidad, status y roles; los errores siguen `{ "error": "…" }`. Mínimos roles aparecen como `x-coreops-min-role`; la autoridad real sigue en `backend/cmd/coreops-api/routes.go`, donde se aplica el middleware de identidad antes del handler extraído. Una extensión OpenAPI no aplica permisos por sí misma.

Cambiar contrato, DTOs TypeScript, mapeadores y tests juntos. No importar modelos del SDK en DTOs. El inspect conserva sus claves complejas legacy mediante objetos JSON propios en el adaptador, no expone structs Go de Moby; su tipado fino/redacción siguen pendientes. No usar los DTOs como modelo de presentación: por ejemplo, la lista no mide CPU/memoria ni cuenta reinicios.

## Validación

Desde `backend/`: `go test ./...` valida OpenAPI y respuestas reales de handlers/middleware con runtimes falsos, incluidos roles, errores, cancelación y auditoría. `contracts_test.go` usa kin-openapi v0.135.0, versión compatible con Go 1.24, sólo en tests; no forma parte del binario de producción.

Desde `frontend/`: `pnpm check:boundaries`, `pnpm format:check`, `pnpm build`, `pnpm test:ui`. El build incluye los DTOs de este directorio por importación de tipos; ejecutar desde un checkout que incluya `api/` y `frontend/`. CI ejecuta contrato y controles de dependencias. No es validación automática de todo endpoint legacy ni generación de clientes.
