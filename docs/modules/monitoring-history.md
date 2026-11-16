# Históricos de CPU/memoria del host

Corrección en `develop`, 2026-11-16: el selector temporal del Dashboard sólo filtraba una lista de muestras del navegador. No solicitaba históricos y perdía datos al navegar/recargar. Ahora consulta los archivos sysstat existentes del servidor a través de CoreOps; conserva muestras en vivo y distingue los intervalos sin datos.

## Módulos y contrato

- `backend/internal/monitoring/history.go`: tipos propios, puerto `HistorySource`, validación de rangos, ordenación, deduplicación y filtrado UTC. Sin HTTP, Docker ni ejecución de comandos.
- `backend/internal/adapters/sysstat/history.go`: lector confinado de archivos `saDD`/`saYYYYMMDD`, decodificados mediante `sadf -j ... -- -u -r ALL`. No instala ni habilita un colector; reutiliza la retención real de sysstat.
- `backend/cmd/coreops-api/monitoring_history.go`: `GET /api/v1/monitoring/history?range=24h`, mínimo viewer, no-store. Rangos 5m/15m/30m/1h/6h/24h/7d/30d; inválido 400, sin acceso/históricos 503. Se añade a las rutas existentes sin alterar el snapshot `/monitoring`.
- `frontend/src/lib/monitoring-history.ts`: lectura cancelable, refresco del histórico a 60 s, combinación por timestamp y conservación de datos obsoletos ante fallos.
- Dashboard y Monitoring consultan históricos para CPU/memoria; gráficas con eje temporal numérico proporcional. No se espacian por igual muestras históricas de diez minutos y muestras live de cinco segundos. La selección no cambia tras refrescar. El historial del servidor vuelve a estar disponible al recargar/navegar.

Respuesta: `{source:"sysstat",range,from,to,samples:[{time,cpu,memory,intervalMs}],warnings}`. Instantes en milisegundos UTC; porcentaje no disponible es null, nunca cero supuesto. Los arrays vacíos significan que no se conservaron muestras para ese intervalo.

CPU = 100 - idle - iowait, compatible con el lector live. Memoria = 100 × (MemTotal - MemAvailable) / MemTotal; MemTotal histórico se reconstruye de memfree + memused + buffers + cached + slab, campos emitidos por `-r ALL` en sysstat 12.6. Si faltan componentes no se sustituye por memused-percent, cuya definición es distinta. Reinicios reportados y separaciones mayores a la cadencia generan cortes en la línea; no se interpolan datos faltantes.

## Configuración y límites

`COREOPS_SYSSTAT_DIR` apunta al directorio del servidor (por defecto `/var/log/sysstat`). Requiere `sadf` instalado y permisos de lectura existentes de la cuenta del servicio. No hay rutas ni opciones de ejecución proporcionadas por el navegador, sudo ni nuevos grupos/ACL. Los archivos deben ser regulares y no symlinks. Se abren mediante os.Root, NOFOLLOW/NONBLOCK y se pasan por descriptor heredado para evitar cambios de ruta durante la lectura.

Entorno del comando mínimo, sin secretos CoreOps heredados. Máximo dos decodificaciones simultáneas, 3 s por archivo/10 s por petición, 4 MiB de salida por archivo y 64 archivos por consulta; más de 10000 muestras por rango se rechaza. Caché acotada de muestras por inode/tamaño/mtime; las consultas no fuerzan una decodificación por cada refresco del navegador. Archivos ilegibles/incompatibles se señalan como cobertura parcial. Las capturas no se guardan en localStorage.

Los plazos y frecuencia disponibles dependen del colector y su retención, no del selector. En este host hay archivos diarios reales y muestras aproximadamente cada diez minutos, incluidas las del día anterior. No hay recuperación de fechas ya borradas/que nunca se recogieron, ni backfill inventado. Sin sysstat, se explica el fallo y se conserva explícitamente sólo el historial live de sesión. Disk I/O y Network de Monitoring continúan siendo datos de sesión; no se anuncian como archivo histórico. No incluye históricos Kubernetes ni de cada contenedor.

## Verificación

Pruebas unitarias/HTTP/race validan CPU/RAM, timestamps UTC, campos ausentes, permisos/rangos, cancelación, symlinks/directorios, entorno/argv/descriptores y caché. `COREOPS_TEST_SYSSTAT=1 go test -race ./... -run '^TestHistory' -count=1` añade lectura explícita de los archivos reales del host, sin mutaciones. Playwright comprueba carga 24 h, navegación/recarga, errores con datos conservados, rango vacío y Monitoring.

Referencia del formato/argumentos: [manual oficial de sadf](https://github.com/sysstat/sysstat/blob/master/man/sadf.in). La implementación y las pruebas del host usan sysstat 12.6.1; no se presupone el formato de una versión que no exponga esos campos.

Validación completada: suite Go completa con race, vet/build y controles de imports; build/formato frontend; 80 escenarios Playwright (un test existente de logs necesitó reintento y su repetición aislada pasó). Chromium con API CoreOps aislada leyó 143 muestras reales de las últimas 24 horas, incluyendo el día anterior, y verificó recarga y vista móvil sin errores de navegador. La primera muestra CPU/RAM se contrastó numéricamente con la salida nativa de sadf. API e identidad temporales limpiadas, sin modificar los archivos sysstat ni contenedores.

API de desarrollo actualizada en 8082: `/tmp/coreops-history-api`, log/PID `/tmp/coreops-history-run/`. Se conservan entorno/directorio y los archivos users/sessions idénticos; Vite 5173 sirve el endpoint autenticado nuevo.
