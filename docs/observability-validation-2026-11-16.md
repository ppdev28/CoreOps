# Validación real de observabilidad — 2026-11-16

Rama `feature/observability-prometheus-grafana`, creada desde `develop` tras
`b38f993` (históricos sysstat). Implementación descrita en la
[guía de operación](observability.md). Este informe registra verificaciones
realizadas, separadas de fixtures y limitaciones.

## Entorno y preservación

Ubuntu Server `ppserver`, Docker Engine real, backend Go nativo y Vite existente.
No había una integración Prometheus/Grafana reutilizable en el repositorio.
Los puertos 9090 y 3000 ya estaban ocupados por aplicaciones del usuario: se
conservaron y se usaron puertos exclusivos de loopback 19090/19100/13000.

Se arrancó únicamente el proyecto Compose nuevo `coreops-observability`, con
imágenes fijadas por digest (Prometheus 3.16.0, node_exporter 1.12.1, Grafana 13.3.1).
Tres healthchecks correctos. API de desarrollo 8082 recompilada/reiniciada con su
entorno y directorio anteriores más las variables de observabilidad. Hashes de
`users.json`/`sessions.json` iguales antes/después; no se añadieron identidades a
la instalación del usuario. Validación autenticada mediante otra API en loopback
8083 y un almacén de identidad viewer temporal, sin mutaciones Docker/host.

## Recogida y consultas

- Prometheus: target `coreops-api / 127.0.0.1:8082` **up** y target
  `coreops-host / 127.0.0.1:19100` **up**.
- `node_uname_info.nodename=ppserver`, coincide con `uname` del host.
  `node_memory_MemTotal_bytes=16603242496`: host real, no límites del contenedor.
- Métricas HTTP reales con ruta `/api/v1/health`, métodos/códigos/transporte;
  proceso/runtime presentes. Scrapes no incrementan contadores de negocio.
- `smoke.py`: las series de CPU, memoria, disco, receive, transmit y uptime de
  CoreOps coincidieron **exactamente** en tiempos/valores con `query_range`
  directo de Prometheus usando las expresiones y el mismo intervalo/resolución.
- Filtros job/instancia/recurso aplicados; instancia inexistente devolvió series
  vacías sin error, no ceros. Acceso anónimo a resumen: 401.
- Grafana: `/api/health` correcto, datasource `coreops-prometheus` health **OK**;
  dashboards `coreops-host` (7 paneles) y `coreops-backend` (9 paneles) provisionados.
  Enlace generado conserva UID, job, instancia y ambos instantes en milisegundos.

## Ensayo de alerta sin interrumpir infraestructura del usuario

Se ejecutó el [smoke reproducible](../deploy/observability/smoke.py) con `for=2m`
por defecto, sin acortarlo:

1. Servidor de métricas HTTP temporal en un puerto loopback asignado por el SO.
2. Descubrimiento file_sd bajo el job exclusivo `coreops-test`; scrape **up**.
3. Se detuvo **sólo ese servidor temporal**: alerta TargetDown **pending**.
4. Después del tiempo de Prometheus: **firing** observado mediante la API autenticada.
5. Reinicio del mismo target: scrape **up**, alerta activa retirada.
6. Se restauró el fichero vacío de test-targets. No historial de incidentes creado.

No se paró ningún exporter ni contenedor real para producir fallos. El host también
produjo una condición real `HostDiskLow` sobre `/` (ext4, volumen Ubuntu): alrededor
de **8,3 % disponible** al consultar. Se mostró la evidencia; no se borraron datos
ni se intentó remediar automáticamente.

## Estados de fallo e interfaz real

Dos procesos Go temporales, con identidad aislada y fuentes reales restantes:

- Prometheus configurado a un puerto loopback inaccesible: estado Prometheus
  unhealthy, Grafana healthy, resumen **503** (no supuesto estado saludable).
- Grafana inaccesible: Grafana unhealthy, Prometheus healthy y resumen **200**
  con los recursos/métricas reales.
- Permisos upstream 403 se cubren con servidores `httptest`: error de integración,
  distinto de 401/403 de la sesión CoreOps. No se exporta el contenido sensible.

Chromium real → Vite existente → API Go aislada → Prometheus/host reales:
Overview, Infrastructure (`ppserver`), Services, gráficas y tasas/unidades.
Sin `pageerror`; sin overflow a 390 px. Se investigó también la alerta real
`HostDiskLow`, seleccionando automáticamente host/instancia y un rango móvil
para consultar CPU/memoria/disco/red del recurso. Recargar conservó `obs_tab=services` y su
contexto. Chromium inició sesión en Grafana real y abrió el dashboard del host con
job/instancia, viendo los paneles provisionados. El transporte de prueba redirigió
`/api/v1` al proceso aislado; no sustituyó ni fabricó respuestas de infraestructura.
Capturas privadas en `/tmp/coreops-obs-live-*.png`, no versionadas y temporales.

## Comprobaciones automatizadas

- Go: `go test -race ./...`, `go vet ./...`, build del binario en `/tmp` correctos.
  Fronteras de módulos, telemetry (rutas normalizadas, scraping, WebSocket 101),
  filtros/rangos/percentiles, NaN/Inf, cancelación, cache, límites, redirects,
  secretos y endpoints con sesión/roles cubiertos.
- Frontend: `pnpm check:boundaries`, `pnpm format:check`, `pnpm build` correctos.
  Sin nuevas dependencias runtime JS ni advertencias de tamaño de chunks.
- Playwright completo: **88 pruebas correctas**, incluyendo las 80 anteriores y
  ocho nuevas de observabilidad. Pantallas existentes en ocho formatos 320–2560 px,
  alertas/recuperación/desconexión, filtros/24h/URL/reload/Grafana, no data/403,
  pausa/gaps/retención de muestras y observabilidad a 320/768/1920 px.
- Python: validación del generador, umbrales/tiempos, auth de scraping y dashboards.
- `promtool check config`: configuración válida y seis reglas.
  `promtool test rules`: éxito; fixtures target pending/firing/recovery y reglas
  HTTP con suficiente tráfico, bajo tráfico y sin muestras; presión CPU/memoria/disco
  sostenida y exclusión de filesystem virtual/readonly/montajes Docker.

Advertencias no bloqueantes: Playwright/Node avisa de NO_COLOR frente a FORCE_COLOR;
Recharts legacy emite medidas cero al ocultar vistas durante navegación. No se
observaron errores runtime ni desbordamientos en el pase final (88 pruebas, sin reintentos).

## Límites de lo verificado

No compilación Android/iOS ni teclado/dispositivo físico: faltan Java/SDK Android
configurados en este servidor. La entrada Android se añadió conservando sus iconos.
No ensayo de presión CPU/memoria/disco ni inyección de 5xx/latencia en servicios
reales; reglas validadas con promtool y target desechable. Sin datos anteriores a
instalar Prometheus: las 24h se llenan con recogidas futuras, mientras sysstat sigue
sirviendo históricos en las vistas existentes.

Grafana queda en loopback: desde otro equipo requiere el túnel documentado o un
proxy HTTPS/Tailscale administrado por el usuario y `COREOPS_GRAFANA_PUBLIC_URL`
correspondiente. No se modificó su proxy/Tailscale ni se amplió exposición de red.
No se instaló un servicio de producción, no se modificó el despliegue SSH legacy y
no se hizo merge/push de esta rama.
