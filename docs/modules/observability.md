# Observabilidad Prometheus / Grafana

## Responsabilidad e implementación

Implementado en `feature/observability-prometheus-grafana`, después de guardar los
históricos sysstat en `b38f993`. No sustituye Monitoring, Dashboard, Host, Containers,
Logs ni Terminal.

- `backend/internal/telemetry`: registro Prometheus por instancia y middleware HTTP.
- `backend/internal/observability`: consultas, catálogo PromQL, filtros,
  transformaciones, inventario/recursos, alertas activas y enlaces de contexto.
- `backend/internal/adapters/prometheus`: HTTP limitado a fuentes configuradas,
  conversión de API Prometheus y comprobación independiente de Grafana.
- `backend/cmd/coreops-api/observability.go`: composición/configuración y handlers;
  `routes.go` mantiene autenticación/roles.
- `frontend/src/features/observability`: pantalla lazy, API, URL compartible y
  gráficas; navegación web y entrada Android. No cliente Prometheus en navegador.
- `deploy/observability`: Compose opcional Linux, configuración privada generada,
  reglas, dashboards provisionados y smoke sobre target desechable.

## Límites y reglas de mantenimiento

Prometheus es el único evaluador. Alertas activas y reglas, sin historial de
incidentes ni notificaciones externas/Alertmanager. No Datadog/Loki/Tempo/APM.
CoreOps consulta un catálogo cerrado; no aceptar PromQL, URLs o credenciales del
navegador. Mantener labels de ruta normalizados, cardinalidad acotada y separación
de scrapes/WebSockets. Los percentiles requieren sumar buckets por `le`, nunca
promediar percentiles. Disco por filesystem; resumen = máximo, nunca suma de %.
Ausencia/NaN/Inf son `null`/sin serie; error no significa cero ni recuperación.

Viewer es lectura global de los recursos publicados por esa instancia Prometheus;
no se añade autorización multitenant por host/job. `/metrics` exige otro Bearer,
configurado en servidor y desactivado si falta. Exporters/Prometheus/Grafana del
perfil permanecen en loopback; node_exporter requiere namespaces/montajes del host.

[Instalación, contrato, cálculos, variables, umbrales y diagnóstico](../observability.md).
[Resultados y alcance de validación](../observability-validation-2026-11-16.md).

## Validación

Go race/vet/build, fronteras Go/TS, formato y build frontend, Playwright (incluye
roles, URL/reload, contexto Grafana, gaps, errores/retención de muestras, recuperación
y móvil), Python stdlib y `promtool check config`/`test rules`. El smoke real compara
series con Prometheus y sólo interrumpe su propio target de prueba. No detener
contenedores del usuario para validar una alerta.
