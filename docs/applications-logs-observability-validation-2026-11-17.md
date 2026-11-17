# Logs, Applications y recuperación de Observability — 2026-11-17

Trabajo en `develop` sobre el worktree pendiente, conservando la entrega anterior
de visor/Terminal y el launcher. Sin commit/push ni cambio de rama.

## Cambios

- Pause en Logs cancela una lectura pendiente sin iniciar otra por cambiar el
  flag live; tampoco recarga el catálogo Docker al pausar. Estado explícito si no
  llegó el primer snapshot, `aria-pressed`, Resume y refresh manual conservados.
- Observability usa margen exterior/gap de 24 px, padding de cards de 20 px,
  separación de grids y cabeceras/cálculos, alertas con padding explícito y cuatro
  métricas por fila en escritorio/dos en móvil. Sin cambios de datos o rutas.
- Applications cruza únicamente sus IDs de miembros con el inventario real y
  compone desde App el inspector existente de Containers. Retorno contextual,
  nombres/imágenes/estado/redes/puertos/creación, miembros ausentes y errores
  visibles. Roles existentes, confirmación de acciones y estado observado después
  de mutaciones; errores persistentes. Hashes largos de imagen se ajustan a móvil.

Guías: [Logs](modules/logs.md), [Applications](modules/applications.md),
[Observability](modules/observability.md), [operación](observability.md).

## Recuperación operativa

Prometheus y Grafana estaban exited 127: faltaban los secretos privados y el bind
corto había creado directorios root-owned en su lugar. Se preservaron esos
**directorios vacíos** en `deploy/observability/generated.empty-mounts-20261117`.
Configuración/secretos regenerados como el usuario del servicio, con modos privados.
No había archivos de credenciales que pudieran recuperarse de esos directorios.

`promtool check config` y las seis reglas pasaron antes del arranque. Se recrearon
sólo los servicios Prometheus/Grafana, sin pulls ni borrado de volúmenes. Se
compararon los nombres de los volúmenes antes/después; se conservaron. El ID del
node_exporter existente no cambió. Los tres contenedores están healthy.

Los nuevos binds de configuración usan `create_host_path: false`; el generador
rechaza directorios/enlaces donde deben existir secretos sin sustituirlos.
Se reinstauraron las seis variables de observabilidad en el backend tmux existente,
con token de scraping nuevo y coordinado. Se compararon usuarios/sesiones por hash:
intactos. El resto del entorno y el frontend previo se conservaron. `/metrics`
responde 200 con el token y 401 sin él. El launcher carga esos defaults sólo al
crear una sesión nueva, sin ejecutar su contenido y respetando exports explícitos.

CoreOps comprueba ambas integraciones como configuradas/saludables y Prometheus
muestra `coreops-api` y `coreops-host` up (2/2), sin errores de scrape. Las escuchas
19090/19100/13000 permanecen exclusivamente en 127.0.0.1. Grafana conserva su base
de datos y contraseña persistida; el fichero nuevo es sólo bootstrap, no un reset.
No se reconstruyen los periodos sin scraping ni se fabrican métricas ausentes.

## Validación

- Frontend: `pnpm check:boundaries`, `pnpm format:check` y build correctos.
- Suite web: 113/115 al primer intento; las pruebas previas de inspect con nulos y
  visor PNG pasaron al repetirlas (2/2). Después del ajuste final para hashes largos
  y distribución visual: **24/24** pruebas de Applications/Logs/Observability.
- Python: cinco pruebas del generador, incluyendo estabilidad/privacidad de secretos
  y rechazo de montajes malformados. Compose config válido y binds sin creación
  implícita comprobados; promtool válido. `bash -n` del launcher correcto.
- Ensayo del bloque de carga de configuración: overrides explícitos conservados,
  claves desconocidas ignoradas y valores con metacaracteres no ejecutados.
- No se cambió código Go en esta entrega. Se mantuvo el binario previamente validado
  con race/vet/build; el reinicio actual aplicó configuración, no otra identidad.

Chromium → Vite 5178 → API aislada 18082 → Docker/Prometheus reales: se consultó la
app de observabilidad con sus tres miembros, inspección/red y vuelta a la app,
390 px con SHA largo, Logs del contenedor seleccionado, Pause sin nuevas lecturas y
Resume, overview con 2/2 targets y curvas reales. Margen/gap/padding medidos y
capturas escritorio/móvil revisadas; sin overflow, errores JS ni peticiones de
mutación desde el navegador. Un primer ensayo descubrió el desbordamiento del SHA;
se corrigió y se añadió a la fixture. Capturas/logs temporales:
`/tmp/coreops-applications-logs-live-skhak0h6/`.

La identidad aislada se revocó/eliminó y sus API/Vite se detuvieron. No se modificaron
apps reales para probar acciones; las mutaciones de ese flujo se verifican con
fixtures. Los únicos contenedores operados fueron los dos servicios que el usuario
pidió recuperar y el promtool efímero retirado automáticamente.

## Acceso remoto y límites

Grafana está disponible localmente en `http://localhost:13000`. No se pudo añadir
Serve privado en HTTPS 8443: Tailscale devuelve acceso denegado para esta cuenta y
`sudo -n` exige autenticación interactiva. Se comprobó que la configuración Serve
existente permaneciera idéntica; no se usó Funnel ni se publicaron otros puertos.

Para habilitar acceso privado remoto, una persona con sudo debe aplicar el proxy
Tailscale en un puerto separado, configurar su URL alcanzable como
`GRAFANA_PUBLIC_URL`/`COREOPS_GRAFANA_PUBLIC_URL` y reiniciar Grafana/backend según
la [guía](observability.md#grafana-accesible-desde-otro-equipo). Este paso de acceso
remoto queda pendiente; la UI nativa de CoreOps ya consulta métricas por su API.

Sin build Android/iOS ni dispositivo físico, despliegue de producción o cambios de
sudoers/permisos del host. Las limitaciones previas de identidad web/nativa,
autoridad Docker y durabilidad de auditoría siguen documentadas en Security.
