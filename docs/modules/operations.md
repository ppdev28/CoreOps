# Operaciones y despliegue

## Estado

El paquete `coreops` instala binario `/usr/bin/coreops-api`, web en
`/usr/share/coreops/web`, unit en `/usr/lib/systemd/system`, cuenta/grupo dedicados
coreops y datos privados en `/var/lib/coreops`. No depende de Vite/tmux/Node en
ejecución. El handler web usa os.Root, sin listados/archivos ocultos ni fallback
HTML sobre API/métricas; assets immutable y HTML no-store. COREOPS_WEB_DIR vacío
conserva API-only.

`coreops-setup` configura identidad, permisos y servicio; migración por pidfd,
copia completa privada, backups y restauración del API previo ante fallo.
No se habilita sin identidad y marcador de configuración. Grupos Docker/journal/
adm y sudoers exactos son opt-in; desarrollo conserva sus helpers locales y el
paquete usa `/usr/libexec/coreops`. Docker sigue dando autoridad amplia.
NoNewPrivileges=false y filesystem sin aislamiento conservan capacidades reales.

Guía: [instalación, migración y APT firmado](../installation.md). El servicio
**está instalado en el host** bajo coreops (ver versión vigente en current-state).
La reparación de Services requiere actualizar paquete y `--add services`,
conservando la política existente; necesita sudo interactivo. Pruebas de setup usan
contenedor descartable y systemctl simulado, no acciones sobre servicios del host. Publicación
pendiente de dominio, licencia y clave de firma de producción.

CI valida main/develop. `packages.yml` compila/inspecciona amd64/arm64; firma y
publicación son independientes. Se elimina el deploy SSH legacy que hacía reset
hard y no instalaba su binario/web. Workflows remotos aún no ejecutados.

## Instrucciones

- Mantener el artefacto instalado separado del checkout. Setup comprueba MainPID,
  inode y liveness/versión; `/health` conserva su dependencia de Docker.
- No sustituir bytes de una versión publicada: generar un `.deb` con otra versión.
- Definir permisos exactos por operación, no reglas sudo genéricas para bash/apt/systemctl. La combinación terminal + Docker permite privilegios de host: separar o deshabilitar capacidades de alto riesgo donde no se necesiten.
- Revisar hardening systemd con los comandos que de verdad se necesitan; no activar `NoNewPrivileges` a ciegas si el flujo sigue dependiendo de sudo.
- TLS mediante proxy/Tailscale Serve, API en loopback por defecto y orígenes explícitos. No exponer socket Docker. Private network no sustituye auth.
- Definir backup/restore de usuarios y políticas, revocación de sesiones al restaurar, rotación/retención de audit y comprobación de permisos de archivos existentes.
- Mantener security-check/workflow de advisories; falta revisión integral de
  licencias/custodia de firma y política de publicación.

## Validación

Pruebas de filesystem/migración/pidfd/policy, inspección del paquete, instalación/
reinstalación/remove/purge en contenedor, API/web reales aisladas, APT real firmado
con descarga/hash y rechazo de tamper; Go race/vet/build. No configura HTTPS ni
ejecuta arm64/power. [Informe](../system-install-validation-2026-11-22.md).
En despliegue real comprobar login/roles, integraciones/permisos, bind/TLS y unit.

## Perfil opcional de observabilidad (2026-11-16)

Existe `deploy/observability/compose.yaml` para Prometheus/node_exporter/Grafana
con versiones/digests fijados, volúmenes y healthchecks, puertos exclusivos de
loopback y configuración privada generada con Python stdlib. CoreOps sigue nativo
en el host; los servicios existentes pueden conectarse sin este perfil.
[Instalación, secretos/usuarios, URL interna/pública Grafana, Ubuntu/macOS,
retención y diagnóstico](../observability.md). CI valida config y reglas con promtool.
El ensayo real sólo interrumpe su target temporal, nunca servicios del usuario.
Su despliegue sigue siendo opcional e independiente del paquete CoreOps.
