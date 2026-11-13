# CoreOps — Roadmap

Revisión 2026-11-12 sobre `develop` (`ece1b7a`). Estado comprobado en código; integración histórica y pruebas actuales se distinguen en [current-state](docs/current-state.md). Prioridades y cierre de riesgos: [security](docs/security.md). Secuencia de entregas: [modularization-plan](docs/modularization-plan.md).

## Implementado

- [x] UI Figma React/TypeScript, carga diferida de vistas y bundle de gráficas separado.
- [x] Contenedores: lista, inspect, start/stop/restart, pendientes, confirmación y refresco; validación real registrada en el hito anterior.
- [x] Endpoints host, aplicaciones, systemd, libvirt, almacenamiento, red, monitoring, logs, seguridad, apt y terminal; madurez de integración desigual.
- [x] Sesiones, roles por ruta, CLI de usuarios, lockout IP+usuario y auditoría de mutaciones/rechazos.
- [x] Tests Go de auth/roles/audit, parsers y validadores; CI con gofmt/vet/tests/build y frontend format/build para main.
- [x] Capacitor Android/iOS y shell Android; no implica validación release o iOS.
- [x] Documentación de arquitectura objetivo, límites, guías de módulos y amenazas. La extracción de código sigue pendiente.

## P0 — seguridad antes de ampliar exposición

- [ ] SEC-01: persistencia/revocación coherente entre CLI y servidor, incluida recuperación ante fallos.
- [ ] SEC-02: política y contención del terminal (permisos, entorno, salida, concurrencia, procesos hijos).
- [ ] SEC-03: estrategia de sesión web, token ligado a servidor, almacén seguro móvil y HTTPS release.
- [ ] SEC-04: privilegios mínimos verificables para Docker/Linux y operaciones elevadas.

## P1 — modularización y fiabilidad

- [ ] OpenAPI inicial de auth/health/contenedores y pruebas de contrato; expandir con cada capacidad.
- [ ] Extraer contenedores backend: transporte, casos de uso y adaptador con interfaz pequeña y tests HTTP/Docker falso.
- [ ] Extraer feature contenedores frontend y transporte común; pruebas de acciones/errores/refresh y datos desconocidos.
- [ ] Corregir contador de reinicios sin dato de origen; revisar fallbacks de seguridad y errores parciales.
- [ ] Migrar capacidades restantes una a una, con README junto al código y dependencias explícitas.
- [ ] SEC-05 a SEC-12: abuso de login, audit, datos sensibles, PID, estados desconocidos, jobs apt, HTTP/proxy y release reproducible.
- [ ] Contenedor: conectar detalle a logs/métricas reales existentes y ampliar inspect sin filtrar secretos.
- [ ] UI audit y gestión de usuarios; reflejar permisos en acciones sin sustituir controles backend.
- [ ] Asegurar rutas de binario/estáticos, instalación y rollback; extender validación a rama de integración acordada.
- [ ] Pruebas de integración seguras, navegador/móvil y estado vacío/no disponible; validación Android/iOS release.

## P2 — producto

- [ ] Histórico de métricas y alertas con notificaciones reales.
- [ ] Mejoras de accesibilidad, teclado, responsive e i18n según necesidad.
- [ ] Imágenes, volúmenes, redes y operaciones destructivas con confirmación y autorización.
- [ ] Terminal PTY/WebSocket sólo después del modelo de seguridad, límites y auditoría.
- [ ] 2FA, automatización y políticas de identidad/recovery.
- [ ] Releases versionadas y backup/restore probado. SQLite/Go embed son opciones a evaluar, no obligaciones por defecto.

## P3 — expansión

- [ ] Agentes remotos/multi-host con identidad y autorización propias.
- [ ] Kubernetes y proveedores cloud cuando haya flujos concretos.
- [ ] SSO/OIDC y automatización avanzada según requisitos.

Capacitor sigue siendo la base móvil actual; esta fase no propone una reescritura. No se necesita un despliegue contenedorizado para modularizar. Un montaje read-only del socket Docker no limita los verbos de su API.
