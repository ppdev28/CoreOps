# Mapa e instrucciones por módulo

Estas guías aplican a las rutas actuales indicadas y a sus futuras extracciones. **No significan que las carpetas propuestas ya existan.** Leer primero los cinco documentos indicados en `AGENTS.md`, después la guía del módulo afectado y [seguridad](../security.md). La decisión y las dependencias están en [arquitectura](../architecture.md).

| Módulo | Implementación actual | Guía |
| --- | --- | --- |
| Contrato de API y transporte | `backend/cmd/coreops-api/{routes,http,handlers,containers}.go`, `frontend/src/lib/api.ts` | [API](api.md) |
| Backend y capacidades de infraestructura | `backend/cmd/coreops-api/*.go` | [Backend](backend.md) |
| Identidad y auditoría | `auth.go`, `users_cli.go`, `audit.go` en el paquete actual | [Identidad](identity-audit.md) |
| Frontend y módulos de producto | `frontend/src/{App.tsx,views,components,lib}` | [Frontend](frontend.md) |
| Plataforma móvil | `frontend/{android,ios,capacitor.config.ts}` | [Móvil](mobile.md) |
| Despliegue y validación | `deploy/coreops.service`, `.github/workflows/ci-cd.yml` | [Operaciones](operations.md) |

Cada guía define responsabilidad, límites, validación y pendientes. Cuando se extraiga una capacidad, añadir su README junto al código con sus operaciones, dependencias, permisos y pruebas; actualizar este mapa en el mismo cambio. No duplicar contratos ni políticas en múltiples documentos.
