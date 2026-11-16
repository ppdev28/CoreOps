# Observabilidad nativa de CoreOps

## Recorrido y alcance

Abrir **Observability → Overview**, seleccionar host/job/instancia y rango, abrir
una alerta en **Alerts**, consultar la expresión y comprobaciones, investigar las
series del recurso, **Open in Grafana** y actualizar para comprobar la recuperación.
**Infrastructure** muestra hosts; **Services**, el backend Go; **Integrations**,
conexión independiente de Prometheus/Grafana y estado de cada scraping.

Datos reales, sin cuenta Datadog. Prometheus almacena/consulta/evalúa; Grafana amplía
la investigación con dashboards provisionados. No hay iframe, Loki, Tempo, APM,
motor propio, historial de incidentes, notificaciones externas ni silencios.
Las alertas y targets son estado **actual**, incluso al seleccionar un intervalo
histórico. Los indicadores métricos se evalúan al final del intervalo seleccionado.

La aplicación sigue siendo React/TypeScript/Vite + Go `net/http`, con Recharts,
sesión Bearer persistida en JSON y roles viewer/operator/admin existentes.
Observabilidad añade una capacidad/adapter y una feature lazy, sin cambiar las
pantallas ni permisos existentes. CoreOps continúa ejecutándose **en el host**.
La retención sysstat del Dashboard/Monitoring sigue siendo independiente.

## Arranque reproducible en Ubuntu Linux

Requisitos: Docker Engine con Compose v2, Python 3 (stdlib), Go >=1.24 y pnpm 10.
No arrancar un segundo CoreOps si ya hay un proceso/servicio en 8082: actualizar la
configuración y el binario de ese proceso conservando su identidad y entorno.

Desde la raíz del repositorio:

```bash
python3 deploy/observability/configure.py
# Crea generated/ privado, secretos nuevos sólo si faltan y configuración JSON/YAML.
# No cambia usuarios/sesiones de CoreOps ni imprime contraseñas.
```

El fichero privado `deploy/observability/generated/coreops.env` contiene las
variables que se deben incorporar al backend. Para un backend de desarrollo nuevo
(o después de parar su proceso anterior), conservar las variables de identidad,
Docker, CORS, terminal y explorador que ya se usaban:

```bash
set -a
. ./deploy/observability/generated/coreops.env
set +a
cd backend
go build -o /tmp/coreops-api-observability ./cmd/coreops-api
# COREOPS_DATA_DIR debe seguir apuntando al mismo directorio del servicio.
/tmp/coreops-api-observability
```

Crear la primera cuenta con `coreops-api user add <nombre> admin`, usando el mismo
`COREOPS_DATA_DIR`, sólo si se trata de una instalación nueva; ver
[backend](../backend/README.md). En otra terminal, desde la raíz:

```bash
docker compose -f deploy/observability/compose.yaml --env-file deploy/observability/.env config --quiet
docker compose -f deploy/observability/compose.yaml --env-file deploy/observability/.env up -d
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend dev --host 0.0.0.0
```

Entrar en CoreOps (Vite 5173, proxy API 8082) con una sesión real. Producción debe
servir los estáticos `pnpm --dir frontend build` detrás del proxy HTTPS existente,
con `/api` dirigido a CoreOps. Esta entrega no corrige el despliegue CI legacy ni
instala una nueva unit: ver [operaciones](modules/operations.md).

El proyecto Compose `coreops-observability` usa **network_mode: host** en Linux:

| Componente | Imagen inmutable, versión verificada | Escucha |
| --- | --- | --- |
| Prometheus | `prom/prometheus@sha256:e04987641b57704f408e31f6373ba4138ecf27cb4a165d24aabb6c38fddd0f06`, 3.16.0 | `127.0.0.1:19090` |
| node_exporter | `prom/node-exporter@sha256:1b4e4438faca4dd7e001dd445d161a4a2091b0fededa84093b3a8dfeae1f1be0`, 1.12.1 | `127.0.0.1:19100` |
| Grafana | `grafana/grafana@sha256:0615ec4fbd4072004b7d86b46ded63013a74b7d6eb1119273dd89e8fa25c13cf`, 13.3.1 | `127.0.0.1:13000` |

Los puertos no colisionan con instalaciones habituales de 9090/9100/3000. No hay
socket Docker montado en estos servicios. Tienen healthchecks, `cap_drop: ALL`,
`no-new-privileges`, filesystem de contenedor de lectura y almacenamiento persistente
para TSDB/Grafana. Retención Prometheus: **15 días, máximo 2 GB** (se aplica el primer
límite alcanzado). Se puede ajustar `PROMETHEUS_RETENTION_TIME` y
`PROMETHEUS_RETENTION_SIZE` en el entorno Compose; no se borra el volumen al recrear.
Los datos nuevos no aparecen antes de la primera recogida: 24h no inventa ni importa
las horas anteriores a instalar Prometheus. Se necesitan al menos dos scrapes para
`rate`, y las series disponibles se representan sobre el intervalo completo con huecos.

node_exporter usa `pid:host`, `uts:host`, red de host y montaje `/:/host:ro,rslave`
con `--path.rootfs`, `--path.procfs`, `--path.sysfs`. Así hostname, procesos,
memoria, discos y red corresponden al Ubuntu monitorizado. El acceso de lectura
al host es sensible: mantener el puerto en loopback y la política de host existente.

`generated/` tiene modo 0700; secretos 0640, `.env`/`coreops.env` 0600. Prometheus y
Grafana añaden el GID del usuario que genera la configuración para leer sólo sus
secretos montados. No hacer estos archivos públicos ni versionarlos. Si se ejecuta
CoreOps con otro usuario systemd, instalar una copia del token con propietario
`coreops`, modo 0600, en un directorio accesible sólo al servicio y usar esa ruta en
`COREOPS_METRICS_TOKEN_FILE`. Mantener ambas copias coherentes al rotar.

## Grafana accesible desde otro equipo

El usuario inicial es `admin`; la contraseña aleatoria está **sólo** en
`deploy/observability/generated/grafana-password`. Cambiarla en Grafana según la
política local. Cambiar ese fichero después del primer arranque no cambia una
contraseña ya persistida en la base de datos.

Por defecto el perfil permanece privado. Para probar desde un Mac con SSH:

```bash
ssh -N -L 13000:127.0.0.1:13000 usuario@servidor-ubuntu
```

Abrir `http://localhost:13000` en ese Mac. El valor por defecto de
`COREOPS_GRAFANA_PUBLIC_URL` funciona con ese túnel. Para móviles/LAN/Tailscale,
publicar Grafana mediante el proxy HTTPS/Tailscale Serve administrado por el usuario
y configurar su URL alcanzable; no abrir Prometheus ni el exporter a la red.

```bash
GRAFANA_PUBLIC_URL=https://grafana.example.internal python3 deploy/observability/configure.py
# Incorporar el nuevo COREOPS_GRAFANA_PUBLIC_URL de generated/coreops.env al backend.
docker compose -f deploy/observability/compose.yaml --env-file deploy/observability/.env up -d
```

`COREOPS_GRAFANA_URL` es la dirección **interna** usada para `/api/health`;
`COREOPS_GRAFANA_PUBLIC_URL` es el destino **del navegador**. Un fallo de Grafana no
impide consultar métricas. Los enlaces `/d/coreops-host` y `/d/coreops-backend`
conservan `from`/`to` en milisegundos, `var-job`, `var-instance` y timezone del navegador.
Se requiere login/permiso de Grafana además del de CoreOps.

La fuente provisionada tiene UID `coreops-prometheus`. Los dashboards tienen variables
`job`/`instance`, siete paneles de host y nueve del backend. Regeneración determinista:
`python3 deploy/observability/render_dashboards.py`.

## Servicios existentes y desarrollo en macOS

No hace falta Compose si ya hay Prometheus/Grafana/node_exporter: configurar las URLs
servidor, incluir `/metrics` con Bearer en el scrape existente, las reglas generadas
y el datasource/dashboards en la instalación existente. `COREOPS_PROMETHEUS_NODE_JOB`
y `COREOPS_PROMETHEUS_API_JOB` deben coincidir con sus jobs; usar esas mismas variables
al ejecutar `configure.py` para renderizar reglas/scraping. Ajustar el URL del
datasource Grafana a su Prometheus. No desplegar dos exporters sobre el mismo puerto.

En macOS se puede desarrollar React; mantener el backend operativo en Ubuntu y
consultar sus APIs remotamente. No se ha validado el backend legacy completo en
Darwin. El adapter Go de observabilidad consulta Prometheus desde el servidor. El perfil Linux de este repositorio se ejecuta **en Ubuntu**. Docker Desktop
mide su VM Linux: no presentar esos datos como hardware del Mac ni como el servidor
Ubuntu. Para observar Ubuntu, el exporter y los montajes/namespaces deben estar allí.
Un exporter remoto requiere un transporte privado/autenticado administrado fuera de
este perfil; el navegador nunca habla directamente con él.

## Variables del backend (sin secretos en frontend)

| Variable | Valor/uso |
| --- | --- |
| `COREOPS_METRICS_TOKEN_FILE` / `COREOPS_METRICS_TOKEN` | Bearer exclusivo de scraping, >=24 caracteres; FILE tiene prioridad. Ausente → `/metrics` 503. |
| `COREOPS_PROMETHEUS_URL` | Base HTTP(S) del Prometheus accesible desde Go; perfil `http://127.0.0.1:19090`. Ausente → integración no configurada. |
| `COREOPS_PROMETHEUS_TOKEN_FILE` / `COREOPS_PROMETHEUS_TOKEN` | Bearer opcional hacia Prometheus existente/proxy. |
| `COREOPS_GRAFANA_URL` | Base interna de Grafana; perfil `http://127.0.0.1:13000`. |
| `COREOPS_GRAFANA_PUBLIC_URL` | Base alcanzable por el navegador, independiente de la interna. |
| `COREOPS_GRAFANA_TOKEN_FILE` / `COREOPS_GRAFANA_TOKEN` | Bearer opcional de comprobación Grafana. |
| `COREOPS_OBSERVABILITY_CA_FILE` | CA PEM adicional para fuentes HTTPS; siempre verifica TLS, no hay insecure-skip. |
| `COREOPS_PROMETHEUS_NODE_JOB` | `coreops-host` por defecto. |
| `COREOPS_PROMETHEUS_API_JOB` | `coreops-api` por defecto. |

Tokens FILE limitados a 8192 bytes y sin saltos de línea internos. URLs HTTP(S) fijas,
sin userinfo, query ni fragmento; no se siguen redirects ni proxies del entorno.
Ni tokens ni URLs arbitrarias son parámetros de la API de observabilidad.

Variables del generador: `COREOPS_SCRAPE_TARGET` (`127.0.0.1:8082`),
`COREOPS_NODE_TARGET` (`127.0.0.1:19100`), ambos `host:port`; jobs anteriores,
`GRAFANA_PUBLIC_URL`, los umbrales y tiempos de la siguiente tabla. `.env` de Compose
sólo contiene GID y URL pública, nunca una contraseña. No usar `VITE_*` para secretos.

## Instrumentación y cálculos

`GET /metrics` usa el token de scraping, no sesiones CoreOps. El middleware mantiene
un registro por proceso (sin global compartido):

- `coreops_http_requests_total{method,route,code,transport}`: solicitudes terminadas.
- `coreops_http_request_duration_seconds`: histograma, buckets
  `0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10,30,+Inf` segundos.
- `coreops_http_requests_in_flight{transport}`: solicitudes presentes en el handler.
- Collectors oficiales de proceso y runtime Go (`process_*`, `go_*`).

`route` es el patrón de ServeMux (`/api/v1/containers/{id}`), nunca un ID/URL/usuario.
Rutas no resueltas → `unmatched`, métodos desconocidos → `OTHER`. `/metrics` se excluye
por completo. WebSockets mantienen Hijacker/Flusher, registran upgrades 101 y una
dimensión `transport=websocket`; **todos** los indicadores/alertas HTTP usan
`transport="http"` para excluir su duración de sesión. El tráfico de la propia UI
sí es tráfico HTTP real del backend.

[Catálogo central](../backend/internal/observability/queries.go): selectores exactos
de job/instancia escapados en servidor, ventana de rate de 5 minutos:

| Indicador | Definición / unidad |
| --- | --- |
| Targets accesibles/total | Active configured targets cuyo `health=up` frente al total de active targets, tras filtros. Incluye jobs distintos del host/API. Es resultado del scrape, no garantía de que toda la app funcione. No cuenta dropped targets. |
| Alertas pending/firing | Instancias activas de reglas Prometheus, filtradas por job/instancia/recurso; no eventos ni incidentes históricos. |
| CPU host | `100*(1-avg by(job,instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])))`, % no idle. Resumen exige un solo host seleccionado. |
| Memoria | `100*(1-MemAvailable/MemTotal)`, % usada; también catálogo de bytes usados/disponibles. No se confunde caché recuperable con memoria no disponible. |
| Disco | `100*(1-avail/size)` por filesystem escribible. Tarjeta = `max by(job,instance)`, nunca suma ni media de porcentajes. |
| Red | Suma de rate 5m de contadores receive/transmit de interfaces elegibles por host, B/s. |
| Uptime | `time()-node_boot_time_seconds`, s; tarjeta convierte a días. |
| HTTP req/s | Suma de rates por serie del contador HTTP, antes de agregar para respetar resets. |
| HTTP 5xx % | `100*sum(rate(5xx))/sum(rate(all))`. Si no existe ninguna serie 5xx, sólo se usa un numerador 0 cuando existe tráfico medido. Tráfico 0 → cociente NaN → indisponible. |
| Latencias p50/p95/p99 | `histogram_quantile(q,sum by(le)(rate(bucket[5m])))`, segundos; por instancia, agrupación `job,instance,le`. No se promedian percentiles. |
| En curso / RSS / goroutines | Suma de gauges de instancias seleccionadas; solicitudes / bytes / goroutines. |
| Rutas | `topk(20,sum by(method,route)(rate(requests[5m])))`, req/s de los 20 patrones/métodos con mayor tráfico. |
| Última muestra host | `timestamp(node_uname_info)`, distinta de la hora del último intento de scrape de `/targets`. |

Se excluyen filesystems virtuales (`tmpfs`, `overlay`, `squashfs`, `proc`, `sysfs`,
cgroups, etc.) y montajes bajo `/dev`, `/proc`, `/sys`, `/run`, `/var/lib/docker`,
`/var/lib/containers`. Sólo escribibles. Red excluye `lo`, veth, docker, bridges,
CNI/flannel, virbr, tailscale, tun/tap. Constantes junto al catálogo y generadores;
adaptarlas si la red de interés es una VPN. Las mismas exclusiones se aplican a
paneles/reglas. No se agregan filesystems sumando porcentajes individuales.

Valores no finitos → `null`, respuesta vacía → sin series; ninguno se convierte en
un cero de éxito. La pantalla distingue no tráfico, no muestras y fallo de consulta.
Las gráficas rellenan **sólo con null** el grid esperado y no conectan los huecos.
Arrastrar un intervalo o usar Custom cambia el mismo rango global; en móvil Custom
es el método táctil fiable. Durante refresh se conservan muestras previas; ante
fallo se etiquetan como antiguas y se muestra la última consulta correcta.

## API autenticada y límites

Todas las siguientes rutas requieren sesión existente, mínimo **viewer**:

| GET `/api/v1/observability/…` | Resultado |
| --- | --- |
| `integrations` | Estado independiente Prometheus/Grafana, versiones y endpoints no sensibles. |
| `summary` | Inventario, indicadores, reglas/alertas y errores por métrica. |
| `targets` | Estado del scraping y fallos accionables sanitizados. |
| `series` | Series de los IDs de catálogo `metrics=host_cpu,host_memory,…`. |
| `rules` | Definiciones y alertas activas actuales, expresión, `for`, health, anotaciones. |
| `resources/{id}` | Recurso identificado por hash estable job+instancia, alertas y gráficas. |
| `grafana-link?kind=host` o `coreops` | URL pública fija con recurso y rango. |

Filtros: `resource=all|host|coreops`, `job`, `instance`, coincidencia exacta; strings
<=200 caracteres sin controles. `series`, `resources` y enlaces exigen `from`, `to`,
`step` en **segundos epoch/segundos**. `summary` acepta el mismo intervalo para
indicadores al final (`to`), o ahora sin intervalo. Máximo 30d, paso 5s..1d, <=1000
puntos por serie, hasta 8 IDs por petición, sin duplicados. El frontend selecciona
un paso de al menos 15s para unos 600 puntos sobre todo el rango.

Límites de fuente: 50 series/query, 4 MiB/respuesta, 200 targets, 200 reglas y 500
alertas. Cuatro queries concurrentes por operación y ocho HTTP globales al adapter;
HTTP 7s, consulta PromQL 5s, handler 25s, cancelación por navegación y caché 5s
(máximo 128 entradas). Warnings parciales se conservan y muestran. Errores de métrica
son por indicador; fallo de targets/reglas invalida el resumen para no inventar
salud. El inventario de targets de Integrations se consulta independientemente.

CoreOps 401 → sesión ausente/revocada; 403 → permiso local insuficiente; 400 → filtros
inválidos/límites de solicitud; 404 → recurso desconocido; 503 → fuente inaccesible,
malformada o con permisos upstream rechazados. Un 401/403 de Prometheus se transforma
en problema de integración **503**, no expulsa al usuario de CoreOps. Errores por
métrica en una respuesta parcial aparecen en su `error`, nunca como ceros.

La URL de la pantalla conserva `view=observability` y `obs_tab`, `obs_resource`,
`obs_job`, `obs_instance`, `obs_range`, `obs_from`, `obs_to`, `obs_refresh`, `obs_paused`.
Rangos relativos conservan su duración; Custom conserva instantes absolutos. Volver
a una pestaña/vista o recargar restaura el contexto. No se persisten muestras ni
credenciales de fuentes en la URL. Pausa desactiva polling; Refresh sigue disponible.

## Rutas de lectura

Todas bajo `/api/v1/observability`, sesión viewer o superior, `Cache-Control: no-store`:

| GET | Respuesta / parámetros |
| --- | --- |
| `/integrations` | Estado/configuración no sensible de Prometheus y Grafana, comprobados por separado. |
| `/summary` | Snapshot de resumen, recursos, métricas instantáneas, reglas/alertas y errores por indicador; filtros y ventana opcional para evaluar métricas en `to`. |
| `/targets` | Targets activos filtrados y resultado/fecha/duración del scraping. |
| `/series` | `metrics` = 1–8 IDs del catálogo separados por coma; filtros `resource`, `job`, `instance`; `from`, `to`, `step` enteros en segundos. |
| `/rules` | Definiciones y alertas activas filtradas; expresión, `for`, severidad, anotaciones, salud de evaluación y `activeAt`. |
| `/resources/{id}` | Host/CoreOps reconocido: detalle, alertas y gráficas del recurso; ventana obligatoria. ID opaco derivado de job/instancia. |
| `/grafana-link` | Destino configurado, `kind=host` o `coreops`, filtros y ventana; sólo genera un enlace. |

Los targets de otros jobs siguen visibles en Integrations/alertas; los detalles
especializados y dashboards de esta entrega son host y backend CoreOps. No se
infiere que un exporter desconocido exponga métricas de CPU/HTTP.

## Reglas y configuración

Scraping/evaluación cada 15s. Las reglas se generan con `configure.py`; se pueden
regenerar cambiando estas variables del **entorno del generador**, sin implementar
un evaluador en CoreOps:

| Regla | Umbral por defecto | `for` / variable |
| --- | --- | --- |
| TargetDown | `up == 0` | 2m / `ALERT_TARGET_DOWN_FOR` |
| HostCPUHigh | CPU >85%, `ALERT_CPU_PERCENT` | 10m / `ALERT_HOST_CPU_HIGH_FOR` |
| HostMemoryLow | MemAvailable <10%, `ALERT_MEMORY_AVAILABLE_PERCENT` | 5m / `ALERT_HOST_MEMORY_LOW_FOR` |
| HostDiskLow | Disponible <10%, `ALERT_DISK_AVAILABLE_PERCENT` | 10m / `ALERT_HOST_DISK_LOW_FOR` |
| CoreOpsHTTP5xxHigh | 5xx >5%, `ALERT_HTTP_5XX_PERCENT` | 5m / `ALERT_COREOPS_HTTP_5XX_HIGH_FOR` |
| CoreOpsLatencyHigh | p95 >0.5s, `ALERT_P95_SECONDS` | 5m / `ALERT_COREOPS_LATENCY_HIGH_FOR` |

Ambas reglas HTTP requieren **>=1 req/s por instancia**, `ALERT_MIN_RPS` configurable
(>0). Evita alertas por una o dos peticiones lentas/erróneas sin volumen suficiente.
Umbrales/tiempos validados, duración positiva con sufijo `s`, `m` o `h`.
Las anotaciones explican qué evidencia hay y qué comprobar; no afirman una causa sin
investigar. Reglas inactivas permanecen como definiciones aunque no tengan instancia.
Si el snapshot de reglas falla, no se muestra un supuesto “sin alertas”.

Después de regenerar configuración/reglas, validar y recargar sólo el Prometheus de
este perfil (sin habilitar una API de reload pública):

```bash
docker compose -f deploy/observability/compose.yaml --env-file deploy/observability/.env run --rm --no-deps --entrypoint promtool prometheus check config /etc/prometheus/prometheus.json
docker compose -f deploy/observability/compose.yaml --env-file deploy/observability/.env kill -s HUP prometheus
```

## Pruebas y diagnóstico

```bash
(cd backend && go test -race ./... && go vet ./... && go build -o /tmp/coreops-api-check ./cmd/coreops-api)
pnpm --dir frontend check:boundaries
pnpm --dir frontend format:check
pnpm --dir frontend build
pnpm --dir frontend test:ui
python3 -m unittest discover -s deploy/observability -p 'test_*.py'
python3 deploy/observability/render_rule_tests.py
# Fixtures de promtool para los umbrales/for por defecto:
docker compose -f deploy/observability/compose.yaml --env-file deploy/observability/.env run --rm --no-deps --entrypoint promtool prometheus test rules /etc/prometheus/rules.test.json
```

Las fixtures comprueban pending/firing/recovery del target y el gating por tráfico
de reglas HTTP (también sin muestras), presión de CPU/memoria/disco sostenida y
exclusiones de filesystem. CI ejecuta validación de configuración/reglas.
Después, con el stack opcional activo y un **fichero privado de token viewer CoreOps**
obtenido mediante login legítimo (no es el scrape token):

```bash
python3 deploy/observability/smoke.py --token-file /ruta/privada/coreops-viewer-token
```

El smoke lee host/backend reales, verifica hostname, compara seis series exactamente
con Prometheus, comprueba filtros, no data, 401 y enlace Grafana. Añade un servidor
exporter temporal en loopback a `coreops-test` mediante file_sd. Sólo detiene ese
servidor, espera pending y firing según el `for` real (~2m), lo recupera y verifica
que desaparece la alerta. Restaura el fichero de targets aun si falla; rechaza un
fichero ya ocupado y bloquea ejecuciones concurrentes. No para exporters/servicios
reales ni crea errores HTTP en CoreOps. El script necesita ejecutarse en el Linux
monitorizado y configuración del perfil local. No ejecutarlo contra targets de terceros.

| Síntoma | Comprobación |
| --- | --- |
| Prometheus no configurado/503 | Variables en el **proceso Go activo**, dirección/CA/token, `/-/ready`, logs de CoreOps y `docker compose … ps`. Go no hace hot reload: recompilar/reiniciar el proceso correcto. |
| Sólo exporter down | Integrations muestra Prometheus conectado y ese target down; revisar proceso, puerto, auth/TLS. Último intento no equivale a última muestra correcta. |
| Datos vacíos | Job/instancia exactos, primeros dos scrapes, retención y rango anterior a instalar. No es cero consumo ni Prometheus caído. |
| 403 CoreOps | Rol/cuenta/revocación local. No enviar tokens Prometheus al navegador para evitarlo. |
| Credenciales de fuente rechazadas | Error de integración 503; renovar token/permisos del backend, manteniendo sesión CoreOps. |
| Grafana falla, métricas funcionan | Revisar URL **interna**, `/api/health`; para enlaces revisar URL **pública**, login y túnel/proxy. |
| Gráficas antiguas | Revisar pausa, error de refresh, última consulta/muestra y target health. El snapshot anterior sigue visible con aviso. |
| Hostname equivocado | Verificar Linux real, montaje rootfs/proc/sys y `uts:host`; Docker Desktop no es el host Ubuntu. |
| Regla health error | Ver health/anotación en Alerts, validar expresión con promtool y permisos de Prometheus. No interpretar ausencia de firing como salud garantizada. |

Para detener el stack opcional conservando métricas/dashboards:
`docker compose -f deploy/observability/compose.yaml --env-file deploy/observability/.env down`.
No usar `-v` salvo que se quiera borrar expresamente su histórico. Usuarios/sesiones
CoreOps no viven en esos volúmenes.

## Límites y siguiente trabajo

Sin transiciones de alertas persistidas; recuperación sólo observada en snapshots
correctos, sin historial inventado. Sin cuotas por tenant/host ni edición de fuentes
por UI; viewer ve los recursos que publique esa fuente configurada. TLS/proxy y
URL pública Grafana se administran fuera del perfil privado. Sin backfill desde
sysstat a Prometheus. macOS/Android/iOS físicos requieren validación propia; no se
declara soporte de node_exporter para hardware Mac usando esta Compose Linux.
Las capacidades legacy de seguridad/despliegue siguen registradas en
[seguridad](security.md) y [operaciones](modules/operations.md).

Evidencia concreta: [validación del 16-11-2026](observability-validation-2026-11-16.md).
Referencias oficiales: [API Prometheus](https://prometheus.io/docs/prometheus/latest/querying/api/),
[funciones/histogram_quantile](https://prometheus.io/docs/prometheus/latest/querying/functions/),
[node_exporter](https://github.com/prometheus/node_exporter#using-docker),
[provisioning Grafana](https://grafana.com/docs/grafana/latest/administration/provisioning/).
