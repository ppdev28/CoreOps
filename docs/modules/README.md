# Mapa e instrucciones por módulo

Estas guías aplican a las rutas actuales indicadas y a sus futuras extracciones. **Sólo las rutas marcadas como implementadas existen; el resto del destino sigue siendo propuesto.** Leer primero los cinco documentos indicados en `AGENTS.md`, después la guía del módulo afectado y [seguridad](../security.md). La decisión y las dependencias están en [arquitectura](../architecture.md).

| Módulo | Implementación actual | Guía |
| --- | --- | --- |
| Aplicaciones | `applications.go`, `ApplicationsView.tsx`, `ApplicationContainers.tsx`; inspect compuesto por App | [Applications](applications.md) |
| Tailscale y Settings | `internal/tailscale`, `adapters/tailscalelocal`, `TailscaleSettings.tsx`, helper opcional | [Tailscale](tailscale.md) |
| Network | `network.go`, `ListeningPorts.tsx`, `lib/networkPorts.ts` | [Puertos y filtros](network.md) |
| Seguridad del host | `internal/security`, `adapters/{linuxsecurity,securityscan}`, `SecurityView.tsx` y componentes, monitor/jobs CVE, helper restringido | [Security](host-security.md) |
| Servicios del host | `services.go`, `service_actions.go`, `adapters/linuxservices`, helper restringido y `ServicesView.tsx` | [Services](services.md) |
| Energía del host | `internal/hostpower`, `adapters/linuxpower`, `host_power.go`, `PowerControls.tsx` | [Centro de control](host-power.md) |
| Observabilidad | `internal/{observability,telemetry}`, `adapters/prometheus`, `features/observability`, `deploy/observability` | [Observabilidad](observability.md) |
| Explorador de archivos y visor | `files*.go`, `lib/files.ts`, `FileExplorerView.tsx`, `FileViewer.tsx` | [Archivos](files.md) |
| Actualizaciones | `updates*.go`, `UpdatesView.tsx`, helper APT de deploy | [Updates](updates.md) |
| Históricos del host | `internal/monitoring`, `adapters/sysstat`, `lib/monitoring-history.ts` | [Históricos](monitoring-history.md) |
| Kubernetes | `kubernetes_*.go`, `KubernetesView.tsx`, `lib/kubernetes.ts` | [Kubernetes](kubernetes.md) |
| Creación con Compose | `compose*.go`, `CreateComposeForm.tsx` | [Compose](compose.md) |
| Explorador de logs | `logs*.go`, `LogsView.tsx`, `LogPane.tsx` | [Logs](logs.md) |
| Contrato y transporte (parcial) | `api/`, `backend/internal/transport/httpapi`, router/auth legacy | [API](api.md), [contrato](../../api/README.md) |
| Backend y capacidades | Contenedores en `backend/internal/containers` + `adapters/docker`; resto en `cmd/coreops-api` | [Backend](backend.md), [contenedores](../../backend/internal/containers/README.md) |
| Terminal interactiva host/contenedor | `terminal_{session,host}.go`, `internal/containers/terminal.go`, `adapters/docker/terminal.go`, `views/TerminalView.tsx` | [Terminal](terminal.md) |
| Identidad y auditoría | `auth.go`, `users_cli.go`, `users_http.go`, `audit.go`, `UserManagement.tsx` | [Identidad](identity-audit.md) |
| Frontend | `features/containers`, `shared/{api,platform,ui}`, resto legacy | [Frontend](frontend.md), [feature](../../frontend/src/features/containers/README.md), [shared](../../frontend/src/shared/README.md) |
| Plataforma móvil | `frontend/{android,ios,capacitor.config.ts}` | [Móvil](mobile.md) |
| Despliegue y validación | `deploy/{coreops.service,coreops-setup,debian}`, scripts build/install/deb/APT y workflows CI/packages | [Operaciones](operations.md), [instalación](../installation.md) |

Cada guía define responsabilidad, límites, validación y pendientes. Cuando se extraiga una capacidad, añadir su README junto al código con sus operaciones, dependencias, permisos y pruebas; actualizar este mapa en el mismo cambio. No duplicar contratos ni políticas en múltiples documentos.
