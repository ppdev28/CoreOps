# Architecture

Reviewed against `develop`, commit `ece1b7a`, on 2026-11-12. This document separates the implementation from the proposed destination. Module instructions: [modules/README.md](modules/README.md).

## Decision: modular monolith

Keep one repository, one Go module and one backend process, with a separately built React client. Separate **API contract**, **HTTP transport**, **application capabilities** and **infrastructure adapters**. API is a boundary of the backend, not a third runtime service. There is no current operational reason for microservices, a message broker, multiple Go modules or an independently deployed gateway.

This keeps local calls, straightforward deployments and reviewable changes while allowing independent tests. Revisit process separation when measured isolation, independent scaling or remote agents require it; document that decision first.

## Current implementation

Primera extracción implementada en `refactor/modular-foundation`, desde `develop` limpio, base `b4d64db`:

- `api/`: OpenAPI inicial health/auth/contenedores y DTOs TypeScript de contenedores. Sin proceso, framework o generador propio.
- `backend/internal/containers`: casos de uso, modelos propios y puerto `Runtime`; sin HTTP/Moby. `internal/adapters/docker` implementa ese puerto y captura metadata inspect en valores JSON propios. `internal/transport/httpapi` posee handlers/DTOs de contenedores y helpers JSON.
- `cmd/coreops-api/main.go` compone esos módulos. `routes.go` sigue aplicando mínimos roles antes de sus handlers; identidad, audit, terminal y demás capacidades permanecen en `package main`. Otras capacidades aún usan Moby directamente. No se declara una extracción global completada.
- `frontend/src/features/containers`: cliente, mapeo, modelos y pantallas lazy. `shared/api` posee transporte HTTP, `shared/platform` la única sesión existente, `shared/ui` estados comunes. `lib/api.ts`, `lib/auth.ts` y `lib/types.ts` quedan como fachadas de compatibilidad y para capacidades no migradas. `App.tsx` mantiene navegación/composición.
- Capacitor, UI, rutas y procesos de despliegue existentes se conservan. La coherencia de identidad SEC-01, almacenamiento de sesión SEC-03 y autoridad de host siguen pendientes.

El inspect mantiene el JSON legacy (claves/casing/nulos) sin dejar pasar tipos del SDK entre paquetes. Sus objetos complejos aún no tienen un modelo fino estable: no se oculta esa deuda bajo DTOs gigantes. Frontend normaliza colecciones vacías/nulas válidas y representa reinicios sin medición como null/`—`.

```text
frontend/features -> shared/api -> /api/v1 -> HTTP handlers -> containers.Service -> Runtime <- adapter Docker
                         ^                    ^
                   contrato api/       auth/roles/audit en composición
```

Los tests Go validan contrato, HTTP/roles/auditoría y fronteras de imports; `pnpm check:boundaries` impide imports de features desde shared y lógica runtime en los tipos de contrato. CI ejecuta ambos. Estos controles sólo describen los módulos ya extraídos.

## Target layout (partially implemented; see current scope above)

```text
api/                              # versioned OpenAPI contract, no runtime
backend/
  cmd/coreops-api/                 # startup and user CLI wiring only
  internal/
    app/                          # composition root and configuration
    transport/httpapi/            # router, handlers, DTO mapping, middleware
    identity/                     # users, sessions, authentication, role policy
    audit/                        # audit records and persistence boundary
    containers/                   # use cases, models, consumer-owned ports
    applications/                 # compose existing container use cases
    host/ services/ storage/ network/
    monitoring/ logs/ virtualmachines/ security/ updates/ terminal/
    adapters/
      docker/ linux/ libvirt/ filestore/
frontend/src/
  app/                            # shell, navigation, providers and wiring
  features/
    containers/                   # API adapter, models, hooks, components, views
    auth/ host/ services/ ...      # introduce only when migrating each capability
  shared/
    api/                          # HTTP, errors, contract types; no view models
    ui/                           # existing design primitives and tokens
    platform/                     # server profile and session storage interfaces
```

Create a directory only when moving real code into it. Avoid layers per trivial function, a generic repository framework, and catch-all `utils`, `common` or `BaseService` packages.

## Dependency rules

1. HTTP transport imports capability use cases and maps wire DTOs to their inputs/results. Capabilities do not import `net/http` or transport DTOs.
2. A capability defines small interfaces for the infrastructure it actually consumes. Docker/Linux adapters implement them; only adapters import the Docker SDK or execute host commands. Do not abstract every SDK method.
3. Composition wires implementations. Business packages never reach into composition or discover dependencies through global state.
4. Identity owns session and permission semantics; HTTP middleware enforces access before invoking operations. Transport must preserve current route minimum roles during extraction. Audit policy is explicit, not hidden inside a Docker adapter.
5. Cross-capability composition uses explicit public operations, never another capability's files/store or private adapter. Applications may coordinate containers; containers must not depend on applications. Avoid cycles by moving orchestration to the caller, not by adding a shared dumping ground.
6. The frontend depends on the CoreOps contract, not on Go or SDK models. Feature mappers turn wire types into presentation models, including unavailable values. Features cannot import each other's private implementation; the app composes features through narrow exports.
7. Shared frontend code cannot import features. Native platform details stay behind platform interfaces. Roles used to hide UI actions are convenience; backend enforcement remains authoritative.

Go `internal` restricts consumers outside the backend tree, not sibling imports. The first slice now includes AST import checks for the extracted capability/transport and frontend shared/features. Expand these checks as new modules become real; they are not proof that legacy code is decoupled.

## Contract and operations

Keep existing `/api/v1` routes and wire behavior during extraction. First capture health, session and containers in OpenAPI from handlers and client behavior, then expand per capability. Explicitly specify roles, nullable fields, errors, timeouts and action results. No shared Docker types. Introduce generated clients only after choosing tooling and reviewing generated diffs. Incompatible changes need coordinated migration or versioning.

Preserve cancellation and define per-operation deadlines. Long apt operations need job/status semantics rather than merely extending HTTP timeouts. No automatic retries for mutations. Reconcile actual state after actions; report partial failure in composed operations.

## Migration

See [modularization-plan.md](modularization-plan.md). The explicit modularization request advances a compatible containers extraction and initial contract while retaining identity behavior and existing privileges. SEC-01 remains the next security priority before new privileged functionality. Preserve the Figma design and current URLs. Migrate one capability at a time and keep the app runnable after every step.
