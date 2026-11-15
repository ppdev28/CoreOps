# Creación con Docker Compose

## Estado y responsabilidad

Implementado en `develop` (2026-11-15). Containers → Create container tiene dos métodos: **Single container** conserva el formulario anterior; **Docker Compose** permite pegar YAML/JSON, cargar un archivo UTF-8, validar/previsualizar servicios y crear un proyecto nuevo, con arranque opcional desactivado por defecto. El inventario se actualiza después de la operación; los contenedores se pueden inspeccionar y Applications los agrupa mediante las etiquetas reales de Compose.

- Backend: `cmd/coreops-api/compose.go` (transporte, CLI, persistencia, inspección) y `compose_model.go` (modelo permitido, YAML y preview). Sigue en el paquete ejecutable actual, sin extracción a `internal/`.
- Frontend: `components/CreateComposeForm.tsx`, `CreateContainerDialog.tsx`, `lib/api.ts`, callback en `ContainersView.tsx` y estilos aislados `container-create.css`.
- Dependencia YAML: `gopkg.in/yaml.v3 v3.0.1`, con checksums de Go. El Docker SDK no se cambia. El navegador nunca habla con Docker ni ejecuta Compose.

## Contrato

Todas estas rutas exigen **admin**, con la misma autenticación, revocación y auditoría que creación individual:

| Ruta | Resultado |
| --- | --- |
| `GET /api/v1/compose` | `{available,version,reason}` del CLI local; no inicia contenedores. |
| `POST /api/v1/compose/validate` | Valida un documento y devuelve `{project,hash,services:[{name,image,ports}],volumes,warnings}` sin revelar el entorno del servicio. |
| `POST /api/v1/compose/projects` | Revalida el modelo/hash, comprueba recursos/imágenes locales, reserva el nombre y crea. |

Cuerpo: `{project,compose,start,validationHash?}`. `validationHash` se exige al crear y debe coincidir con el preview actualizado. No es un token de autorización. Cambiar el proyecto o documento invalida el preview en UI; la API siempre revalida. Los valores de entorno no salen en el preview ni se escriben en audit.

Éxito completo: 201 con `{project,state:"created"|"started",containers:[{id,name,service,status}],warnings}`. `started` confirma que Compose aceptó el arranque, no salud permanente. Los estados de cada contenedor proceden de Docker. Fallo después de reservar/iniciar creación: 202, `state:"partial"`, `operationError` y el inventario que se pudo confirmar. Puede haber recursos incluso con cero contenedores observados. No se borra nada automáticamente ni se permite volver a crear el mismo proyecto a ciegas.

Errores antes de mutar: 400 formato/campos no admitidos, 401/403 identidad/rol, 409 hash antiguo/proyecto o recurso existente, 422 imagen local ausente, 502 fallo de consultas Docker, 503 Compose no disponible o lectores ocupados. Fallos de persistencia anteriores a Docker devuelven 500. Las respuestas llevan no-store. No se devuelven stdout/stderr privados del CLI.

## Alcance de Compose

Se admiten 1–16 servicios con imagen local explícita, command/entrypoint, entorno explícito, puertos/expose, volúmenes Docker nombrados o anónimos, redes bridge del proyecto, depends_on, restart, healthcheck, user/working_dir/hostname/domainname, init/tty/stdin_open/read_only/tmpfs, stop_grace_period, cpus/mem_limit/pids_limit, labels no reservadas y cap_drop. Compose comprueba los tipos/dependencias mediante su modelo canónico. Anchors y extensiones `x-` se resuelven; las extensiones no se pasan al CLI. El nombre del campo Project prevalece sobre el nombre raíz del documento.

No se admiten builds, pulls, env_file, include/extends, secretos/configs externos, host bind mounts, dispositivos, privileged/cap_add, host namespaces, callbacks post_start/pre_stop, perfiles/scale/deploy ni redes/volúmenes externos o con nombre/driver arbitrario. No se heredan variables del servidor: entorno con valores explícitos, `${VAR}` rechazado, `$$VAR` para expansión dentro del contenedor. Puertos sin host_ip se normalizan a loopback; una IP explícita (incluido 0.0.0.0) se respeta.

```yaml
services:
  web:
    image: nginx:alpine
    ports:
      - "8088:80"
    volumes:
      - site:/usr/share/nginx/html
    restart: "no"
volumes:
  site:
```

El ejemplo necesita esa imagen local. No es un importador de carpetas/proyectos existentes. El modal sólo crea proyectos nuevos; no actualiza, recrea ni borra aplicaciones existentes. El ciclo start/stop/restart de Applications sigue operando sobre sus contenedores reales.

## Ejecución y seguridad

Requiere el plugin `docker compose` con las opciones usadas por config/create/up (probado con v5.7.0) y el mismo endpoint Unix local del cliente Moby. Los contextos remotos/TLS y credenciales de registros no se incorporan a esta entrega.

Antes del CLI se parsea el YAML y se rechazan referencias a archivos, opciones privilegiadas y campos desconocidos. Después se ejecuta `config --format json --no-interpolate --no-env-resolution --no-path-resolution` y se vuelve a comprobar el modelo normalizado. Los procesos usan argv sin shell, entorno explícito sin credenciales de la API, configuración Docker privada vacía y `/dev/null` como env-file. El PATH sirve para localizar el CLI/plugin instalado. No se concede sudo ni se cambian grupos.

La creación usa `create --no-recreate --no-build --pull never`. Si se pidió arrancar y se confirmó propiedad/inventario, usa `up --detach --no-recreate --no-build --pull never`. No se usan force, remove-orphans, down ni eliminación de volúmenes. Se comprueban etiquetas de proyecto y también nombres generados de redes/volúmenes sin etiquetas, porque Compose podría adoptar recursos preexistentes. Una etiqueta propia aleatoria identifica cada despliegue; no se arrancan contenedores cuya propiedad no se pueda confirmar. El Docker Engine no ofrece una transacción de proyecto: operaciones externas concurrentes todavía requieren coordinación administrativa.

Límites: cuerpo JSON 512 KiB, YAML 128 KiB, profundidad 24/10000 valores, proyecto de 1–63 caracteres lowercase/dígitos/guion/underscore, hasta 32 redes y 32 volúmenes, 32 mounts/puertos y 100 variables por servicio. Salida acotada a 1 MiB por stream; hasta dos validaciones/despliegues concurrentes por API. Capability 5 s, validación 10 s, creación/arranque 30 s, más inspección final acotada de 3 s tras fallo/desconexión. Cancelación mata el grupo de procesos CLI/plugin; peticiones ya recibidas por Docker pueden haber creado recursos y se informan como resultado parcial.

## Persistencia y recuperación

Los proyectos se guardan bajo `COREOPS_DATA_DIR/compose/<project>/`, normalizando la raíz a ruta absoluta aunque la configuración de datos sea relativa. `Mkdir` reserva el nombre entre procesos; directorios 0700 y `compose.json`/`deployment.json` 0600. El manifiesto contiene valores explícitos de entorno: tratarlo como secreto del servicio. No guardarlo en Git ni copiarlo a logs. Se conserva incluso tras una creación parcial; este flujo no tiene borrado/actualización de manifiestos.

Recuperación manual: inspeccionar primero contenedores, redes y volúmenes/etiquetas del proyecto y el resultado de la operación. Coordinar cualquier limpieza o gestión posterior desde el host, conservando datos; sólo liberar la reserva cuando se haya confirmado que no hay operaciones ni recursos que se puedan reutilizar accidentalmente. No borrar reservas como mecanismo automático de retry. El bloqueo/reserva protege procesos CoreOps actualizados, no operadores externos de Docker.

## Validación

Backend: `go test -race ./...`, vet/build; `COREOPS_TEST_COMPOSE_CLI=1 go test -race ./... -run TestCompose -count=1` añade validación real sin mutaciones con el CLI instalado. `compose_test.go` cubre campos/rutas peligrosas, roles/revocación, preview/hash, entorno/proceso hijo, salida/cancelación, colisiones etiquetadas/no etiquetadas, reservas concurrentes, permisos de manifiesto, imágenes ausentes, fallos de disco y resultados parciales.

Frontend: formato/build, suite de 64 pruebas (siete nuevas Compose), creación individual, permisos, pending/escape, drafts, validación invalidada al editar, carga UTF-8, indisponibilidad/retry del plugin, resultados parciales y 320 px.

Integración real: API aislada/admin temporal, proyecto de dos servicios parados con red/volumen propios y proyecto creado/arrancado desde Chromium móvil. Docker confirmó estados, etiquetas, binding loopback, rechazo de duplicados y respuesta HTTP de Nginx. Se repitió con COREOPS_DATA_DIR relativo. Se eliminaron sólo los proyectos de prueba y sus contenedores/redes/volúmenes, API e identidad temporales. Sin instalación de servicio ni builds nativos.

Referencias: [Compose config](https://docs.docker.com/reference/cli/docker/compose/config/), [Compose create](https://docs.docker.com/reference/cli/docker/compose/create/).
