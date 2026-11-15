# Architecture

Reviewed against `develop`, commit `ece1b7a`, on 2026-11-12. This document separates the implementation from the proposed destination. Module instructions: [modules/README.md](modules/README.md).

## Decision: modular monolith

Keep one repository, one Go module and one backend process, with a separately built React client. Separate **API contract**, **HTTP transport**, **application capabilities** and **infrastructure adapters**. API is a boundary of the backend, not a third runtime service. There is no current operational reason for microservices, a message broker, multiple Go modules or an independently deployed gateway.

This keeps local calls, straightforward deployments and reviewable changes while allowing independent tests. Revisit process separation when measured isolation, independent scaling or remote agents require it; document that decision first.

## Current implementation

- `backend/cmd/coreops-api` is one `package main`: startup, HTTP, authentication, persistence and host/Docker integration share a package. Files split by area are not enforced module boundaries.
- `API` directly holds a concrete Moby client; several handlers call SDK/host functions directly. Container inspection still embeds SDK structures in its JSON response.
- `frontend/src/lib/api.ts` mixes HTTP, API types, mapping and all feature clients. Views own fetching and action state; `App.tsx` owns shell/navigation/session composition.
- `frontend/android` and `frontend/ios` reuse the web application through Capacitor. Deployment uses a host service; CI and unit installation paths currently disagree.
- Authentication, roles and audit exist. See [security.md](security.md) for remaining risks; private networking does not replace access control.

```text
Browser / Capacitor -> CoreOps HTTP API -> Docker / Linux / libvirt
```

## Target layout (not yet implemented)

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

Go `internal` restricts consumers outside the backend tree, not sibling imports. Enforce finer rules through review first; add import-boundary checks once the first slice establishes a useful pattern.

## Contract and operations

Keep existing `/api/v1` routes and wire behavior during extraction. First capture health, session and containers in OpenAPI from handlers and client behavior, then expand per capability. Explicitly specify roles, nullable fields, errors, timeouts and action results. No shared Docker types. Introduce generated clients only after choosing tooling and reviewing generated diffs. Incompatible changes need coordinated migration or versioning.

Preserve cancellation and define per-operation deadlines. Long apt operations need job/status semantics rather than merely extending HTTP timeouts. No automatic retries for mutations. Reconcile actual state after actions; report partial failure in composed operations.

## Migration

See [modularization-plan.md](modularization-plan.md). First harden identity persistence, then extract the containers slice with characterization tests; preserve the Figma design and current URLs. Migrate one capability at a time and keep the app runnable after every step.
