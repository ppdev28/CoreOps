# Mapa e instrucciones por módulo

Estas guías aplican a las rutas actuales indicadas y a sus futuras extracciones. **Sólo las rutas marcadas como implementadas existen; el resto del destino sigue siendo propuesto.** Leer primero los cinco documentos indicados en `AGENTS.md`, después la guía del módulo afectado y [seguridad](../security.md). La decisión y las dependencias están en [arquitectura](../architecture.md).

| Módulo | Implementación actual | Guía |
| --- | --- | --- |
| Contrato y transporte (parcial) | `api/`, `backend/internal/transport/httpapi`, router/auth legacy | [API](api.md), [contrato](../../api/README.md) |
| Backend y capacidades | Contenedores en `backend/internal/containers` + `adapters/docker`; resto en `cmd/coreops-api` | [Backend](backend.md), [contenedores](../../backend/internal/containers/README.md) |
| Terminal interactiva | `terminal_session.go`, `views/TerminalView.tsx` | [Terminal](terminal.md) |
| Identidad y auditoría | `auth.go`, `users_cli.go`, `audit.go` en el paquete actual | [Identidad](identity-audit.md) |
| Frontend | `features/containers`, `shared/{api,platform,ui}`, resto legacy | [Frontend](frontend.md), [feature](../../frontend/src/features/containers/README.md), [shared](../../frontend/src/shared/README.md) |
| Plataforma móvil | `frontend/{android,ios,capacitor.config.ts}` | [Móvil](mobile.md) |
| Despliegue y validación | `deploy/coreops.service`, `.github/workflows/ci-cd.yml` | [Operaciones](operations.md) |

Cada guía define responsabilidad, límites, validación y pendientes. Cuando se extraiga una capacidad, añadir su README junto al código con sus operaciones, dependencias, permisos y pruebas; actualizar este mapa en el mismo cambio. No duplicar contratos ni políticas en múltiples documentos.
