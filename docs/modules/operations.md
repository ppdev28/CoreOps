# Operaciones y despliegue

## Estado

El backend es un servicio del host porque administra Docker, systemd, apt y UFW. `deploy/coreops.service` propone usuario `coreops`, grupo `docker`, `PrivateTmp`, `ProtectHome` y `NoNewPrivileges=false`. No hay política sudoers versionada. El grupo Docker sigue otorgando control muy amplio sobre el host.

CI ejecuta gofmt, vet, tests, build y frontend format/build para PRs a `main` y pushes a `main`. El despliegue SSH recompila `backend/scp-api` y reinicia el servicio, pero la unit ejecuta `/opt/coreops/coreops-api`: no existe paso de instalación en el workflow. El workflow tampoco despliega explícitamente los estáticos frontend. La configuración efectiva del servidor no fue inspeccionada.

## Instrucciones

- Resolver la ruta del binario y entrega de estáticos en una entrega propia: artefacto probado, instalación atómica, permisos, health/readiness y rollback. Un restart más health no demuestra que se esté ejecutando el binario recién compilado.
- Evitar `git reset --hard` sobre un checkout de desarrollo; el workflow actual lo contiene. Preferir directorio de release dedicado con artefactos inmutables.
- Definir permisos exactos por operación, no reglas sudo genéricas para bash/apt/systemctl. La combinación terminal + Docker permite privilegios de host: separar o deshabilitar capacidades de alto riesgo donde no se necesiten.
- Revisar hardening systemd con los comandos que de verdad se necesitan; no activar `NoNewPrivileges` a ciegas si el flujo sigue dependiendo de sudo.
- TLS mediante proxy/Tailscale Serve, API en loopback por defecto y orígenes explícitos. No exponer socket Docker. Private network no sustituye auth.
- Definir backup/restore de usuarios y políticas, revocación de sesiones al restaurar, rotación/retención de audit y comprobación de permisos de archivos existentes.
- Añadir verificación de dependencias Go/JS y secretos en CI con política de revisión; todavía no se ha realizado auditoría de dependencias en esta revisión.

## Validación

No desplegar como parte de un cambio documental. En una entrega de deployment, comprobar usuario, permisos, rutas reales, binario instalado y versión, HTTPS, login/403, frontend y rollback en un entorno seguro. Ejecutar CI de validación también en la rama de integración que se acuerde; actualmente `develop` no figura en triggers.
