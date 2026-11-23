# CoreOps API contract

Este módulo describe la frontera entre clientes y backend. **No es otro servidor**: el transporte HTTP se ejecuta dentro del único backend Go. No importar Docker, Linux, React ni lógica de producto aquí.

- `openapi.json`: contrato OpenAPI 3.0.3 inicial de health, login/logout/me y list/inspect/start/stop/restart de contenedores.
- `typescript/containers.ts`: DTOs de contenedores consumidos por el adaptador frontend. Son tipos de wire, sin componentes ni ejecución. Se mantienen manualmente junto al contrato; no se ha introducido un generador ni otro package manager/runtime.
- Resto de `/api/v1`: implementado pero aún fuera de este contrato parcial. La terminal mantiene su [protocolo WebSocket](../docs/modules/terminal.md).
- Security mantiene GET overview y las dos acciones existentes. Añade GET `/security/posture`, `/security/ssh-policy`, `/security/events`, `/security/monitor`, `/security/scans/capabilities`, `/security/scans`; POST `/security/monitor/reset` y `/security/scans`, todos bajo `/api/v1`. Lecturas operator, acciones admin, no-store/private. GET `/api/v1/audit/integrity` es admin. DTOs en `frontend/src/lib/security.ts`, roles/cursores/jobs/límites en [Security](../docs/modules/host-security.md); aún fuera del OpenAPI parcial.
- GET/POST `/api/v1/tailscale` son sólo admin: snapshot saneado del daemon local y cambios limitados con revisión, confirmación, revalidación y audit previo. DTOs propios en `frontend/src/lib/tailscale.ts`, contrato y límites en [Tailscale](../docs/modules/tailscale.md); todavía fuera del OpenAPI parcial.
- Las rutas admin `/api/v1/terminal/passwords/{target}` (GET estado, POST guardar, DELETE olvidar) y POST `.../reveal` tienen contratos/límites y pruebas descritos en [Terminal](../docs/modules/terminal.md). El valor sólo se recupera por acción explícita y no entra en el OpenAPI parcial todavía.
- Desde 2026-11-18, GET/POST `/api/v1/users` y `/api/v1/host/power` son sólo admin, con contratos y límites descritos en [identidad](../docs/modules/identity-audit.md) y [energía](../docs/modules/host-power.md). Sus handlers tienen pruebas HTTP; todavía no se incorporan al OpenAPI parcial.

## Cambios

Leer `docs/modules/api.md`. Conservar URLs, casing, nulabilidad, status y roles; los errores siguen `{ "error": "…" }`. Mínimos roles aparecen como `x-coreops-min-role`; la autoridad real sigue en `backend/cmd/coreops-api/routes.go`, donde se aplica el middleware de identidad antes del handler extraído. Una extensión OpenAPI no aplica permisos por sí misma.

Cambiar contrato, DTOs TypeScript, mapeadores y tests juntos. No importar modelos del SDK en DTOs. El inspect conserva sus claves complejas legacy mediante objetos JSON propios en el adaptador, no expone structs Go de Moby; su tipado fino/redacción siguen pendientes. No usar los DTOs como modelo de presentación: por ejemplo, la lista no mide CPU/memoria ni cuenta reinicios.

## Validación

Desde `backend/`: `go test ./...` valida OpenAPI y respuestas reales de handlers/middleware con runtimes falsos, incluidos roles, errores, cancelación y auditoría. `contracts_test.go` usa kin-openapi v0.135.0, versión compatible con Go 1.24, sólo en tests; no forma parte del binario de producción.

Desde `frontend/`: `pnpm check:boundaries`, `pnpm format:check`, `pnpm build`, `pnpm test:ui`. El build incluye los DTOs de este directorio por importación de tipos; ejecutar desde un checkout que incluya `api/` y `frontend/`. CI ejecuta contrato y controles de dependencias. No es validación automática de todo endpoint legacy ni generación de clientes.


## Services — permiso explícito (2026-11-23)

Rutas existentes conservadas: `GET /api/v1/services` viewer;
`POST /api/v1/services/{name}/{start|stop|restart}` operator/admin.
El inventario añade el objeto opcional `management: {available: boolean, reason?: string}`.
Es una indicación preliminar, no garantía de que la unidad sea controlable;
el helper revalida archivos/alias al ejecutar. Sin permiso conserva lecturas.
Las acciones aceptan cuerpo vacío u objeto vacío, sin query, y unidades `.service`
ASCII simples. 200 conserva `{ok,name,action}` tras ejecución síncrona confirmada;
400 validación, 403 permiso/protección, 404 no encontrada, 409 operación en curso,
503 audit/helper no disponible o resultado incierto. Sin reintento automático.
Sesión/rol frescos bajo bloqueo de identidad e intención durable antes del efecto;
`Cache-Control: no-store`. [Política completa](../docs/modules/services.md).
