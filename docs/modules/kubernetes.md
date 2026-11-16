# Kubernetes — primera versión operativa

Implementada en `feature/kubernetes-observability` (2026-11-15). La navegación web y Android añade Kubernetes sin cambiar las rutas existentes. El recorrido es incidencia → detalle → eventos/logs → escalado o reinicio → estado observado. No hay recursos ni métricas de demostración en la aplicación; los fixtures viven sólo en los tests.

## Responsabilidad y límites

- `backend/cmd/coreops-api/kubernetes_client.go`: perfiles privados, TLS, transporte REST, namespaces y comprobaciones de acceso. Sin kubectl ni dependencia del SDK Kubernetes.
- `kubernetes_resources.go`: DTOs propios, consultas, condiciones, eventos, YAML, logs y acciones de Deployment.
- `frontend/src/lib/kubernetes.ts`, `views/KubernetesView.tsx`, `styles/kubernetes.css`: cliente CoreOps, pantalla, detalles y presentación responsive con los tokens existentes.
- El navegador habla exclusivamente con CoreOps. Las credenciales Kubernetes se envían al guardar la conexión y no se incluyen en listados ni se guardan en almacenamiento web.

La primera versión incluye múltiples conexiones, namespace individual/todos los configurados, búsqueda y estado persistentes durante la sesión y al navegar, resumen, Deployments/StatefulSets/DaemonSets de consulta, Pods, incidencias, Nodos, eventos, YAML de consulta, logs y escalado/reinicio de Deployments. En móvil las filas se convierten en tarjetas, con detalle completo y diálogos contenidos en el viewport.

Las pestañas Red/Configuración/Almacenamiento describen su alcance futuro; **no consultan ni gestionan esos recursos todavía**. También quedan pendientes exec de pods, historial de métricas y rollback. No conectar la terminal del host para simular exec Kubernetes ni exponer valores de Secrets.

## Conectar un clúster

Desde **Kubernetes → Connections**, un admin introduce nombre único, origen HTTPS del API server, namespaces y autenticación mediante bearer o certificado/clave PEM incrustados. Se puede aportar CA PEM; sin ella se usa la confianza del sistema. Se verifica `/version` y se guarda el perfil sólo tras la respuesta válida. La lista de namespaces explícita limita el alcance de las llamadas; `*` requiere descubrir namespaces y permite consultas globales sujetas a RBAC.

El backend debe poder alcanzar el API server con el nombre/IP cubierto por su certificado. No se admiten HTTP, TLS sin verificación, URL con usuario/query/path, redirects, proxies del entorno, rutas de certificados/keys en el host ni plugins `exec`/auth-provider. No se importa kubeconfig en esta versión. Ver [precauciones oficiales de kubeconfig](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/).

Perfiles: `<COREOPS_DATA_DIR>/kubernetes/<id>.json`, directorio 0700 y archivos 0600. Publicación completa mediante temporal/fsync/link exclusivo: nombres duplicados devuelven 409, sin sobrescribir credenciales. Los archivos contienen credenciales **sin cifrado adicional**; proteger el directorio y sus backups como identidad. No versionarlos. La eliminación de una conexión sólo borra su perfil, nunca recursos Kubernetes. Para cambiar/renovar credenciales, eliminar y volver a crear la conexión con el mismo nombre. No hay renovación automática de tokens ni credenciales cloud ejecutables.

Las credenciales son de servicio **compartidas**, no una identidad Kubernetes por cada usuario CoreOps. Los perfiles/alcance de namespaces están disponibles a las sesiones CoreOps; los roles locales limitan operaciones y lecturas sensibles. No se implementa impersonación ni autorización por namespace distinta para cada usuario. Usar una cuenta dedicada con RBAC mínimo y no ampliar exposición de CoreOps como consecuencia de esta entrega.

## API y permisos

Todas las respuestas sensibles tienen `Cache-Control: no-store`. Las rutas se añaden bajo `/api/v1/kubernetes`:

| Método / ruta | Rol mínimo | Resultado |
| --- | --- | --- |
| GET `/clusters` | viewer | Metadatos, nunca token/CA/key |
| POST `/clusters` | admin | Verificar y guardar una conexión nueva; 201 |
| DELETE `/clusters/{id}` | admin | Eliminar sólo la conexión |
| GET `/{id}/snapshot?namespace=` | viewer | Colecciones, eventos, métricas opcionales y errores por fuente |
| GET `/{id}/resources/{kind}/{namespace}/{name}` | viewer | DTO, condiciones, pods relacionados, eventos, capacidades |
| GET `/{id}/resources/{kind}/{namespace}/{name}/yaml` | operator | Manifiesto de consulta, sin managedFields/last-applied |
| GET `/{id}/resources/pods/{namespace}/{name}/logs?container=&previous=` | operator | Snapshot acotado con timestamps reales |
| POST `/{id}/deployments/{namespace}/{name}/scale` | operator | UID, resourceVersion y replicas 0–1000 |
| POST `/{id}/deployments/{namespace}/{name}/restart` | operator | UID y resourceVersion; sin edición arbitraria |

`kind` admite deployments/statefulsets/daemonsets/pods/nodes. Para nodos, namespace de URL `_`; los demás recursos requieren un namespace concreto dentro del alcance configurado. Los errores de una colección se mantienen separados de una lista vacía. Una conexión caída no devuelve un resumen saludable con ceros. El navegador conserva el snapshot anterior identificándolo como obsoleto.

Kubernetes vuelve a autorizar cada consulta/PATCH con las credenciales configuradas. [SelfSubjectAccessReview](https://kubernetes.io/docs/reference/kubernetes-api/definitions/self-subject-access-review-v1-authorization/) comprueba capacidades de logs/acciones; si no se puede comprobar, se deshabilitan. Además se comprueba permiso antes de mutar, sin confiar en la UI. Un viewer no obtiene YAML ni logs. Los manifiestos y logs pueden incluir contenido sensible, por eso mantienen operator.

La cuenta necesita get/list sobre workloads, pods y events en los namespaces configurados; get pods/log para logs; get/patch deployments/scale para escalado y patch deployments para reinicio. Las acciones también requieren leer el Deployment y crear SelfSubjectAccessReviews (normalmente proporcionado por los roles de descubrimiento/autorización de Kubernetes). Nodes, namespaces globales y metrics.k8s.io requieren permisos propios de clúster y son opcionales. No se requieren secrets, pods/exec, create/delete workloads ni privilegios cluster-admin. Denegar nodos o métricas deja disponibles los workloads permitidos.

## Progreso y fidelidad de datos

- Running y Ready se muestran separados: la fase de ejecución no implica preparación para tráfico. Reinicios acumulados >=3, fallos reportados, pods Running no preparados, planificación fallida y Deployments incompletos alimentan incidencias. El umbral de reinicios es un contador acumulado, **no una frecuencia medida**. Se reproduce la evidencia y no se adjudica una causa raíz inventada.
- Eventos se vinculan por UID y se ordenan por fecha descendente; incluyen pods seleccionados por el LabelSelector completo del workload. La UI explica la retención temporal de eventos.
- Los nodos son de ámbito clúster. Sus pods se limitan al alcance permitido por la conexión; con namespace individual no se inventa un total de pods del nodo.
- Las métricas son muestras de Metrics API, con timestamp/ventana y número de nodos muestreados. Ausencia/RBAC/error → unavailable, nunca porcentajes estimados. No hay series históricas.
- Logs consultan las últimas 1000 líneas / 256 KiB, cada 2,5 s sin solapar llamadas; no es un stream watch. Pausa detiene lecturas de logs, búsqueda filtra el snapshot y descarga exporta ese snapshot. Previous pide el intento anterior del contenedor cuando tiene reinicios; el runtime puede haberlo eliminado.
- Consultas HTTP: 15 s por llamada / 30 s por handler (snapshot 25 s), cuerpo upstream máximo 8 MiB. Listas paginadas, máximo 4000 recursos por colección; scopes explícitos hasta 50 namespaces. Descubrimiento global de namespaces limita 2000 y rechaza truncamiento. Las consultas de cada colección tienen un máximo de seis ramas simultáneas por snapshot. No hay caché global ni límites de concurrencia entre todos los usuarios; reducir scope/auto-refresh para clústeres grandes.
- Scale y restart releen UID/resourceVersion, rechazan reemplazos/cambios, usan PATCH con precondición resourceVersion y no reintentan. Deployment pausado/terminando no se modifica; Recreate no se anuncia como rolling restart.
- 202 significa **aceptación**, no recuperación. La UI consulta cada 3 s hasta observar la generación solicitada, réplicas actualizadas/disponibles y retirada de réplicas antiguas. Una generación posterior o reemplazo se identifica como cambio externo; no confirma falsamente el resultado propio. El seguimiento vive en el detalle, no es un job durable si se cierra la pantalla.
- Auditoría CoreOps registra actor, target, operación y resultado HTTP (incluido 202). No registra tokens/manifiestos/logs ni persiste el resultado final del controlador como un job; conserva las limitaciones de durabilidad/retención SEC-06. Un error de transporte de PATCH se identifica como resultado potencialmente ambiguo: refrescar antes de volver a intentar.

## Validación y continuación

`go test -race ./... -run '^TestKube'` utiliza un API HTTPS de prueba real con CA, credenciales y middleware CoreOps; prueba persistencia/privacidad, roles, scope, TLS, DTOs, errores parciales, logs, conflictos, PATCH y auditoría. `frontend/e2e/dashboard/kubernetes.spec.ts` usa fixtures aislados para recorrido de diagnóstico, progreso de scale, permisos, filtros, logs, conexión y responsive. La suite de navegación general también visita Kubernetes en sus ocho formatos.

En el host revisado no hay kubectl, kubeconfig ni un clúster configurado para validar. No se instaló un clúster ni se alteró infraestructura existente. Falta probar estos flujos contra el clúster del usuario con credenciales de alcance limitado, además de compilar/validar Android en su toolchain. No declarar integración con un clúster vivo por pasar fixtures o httptest.

Validación completada: Go full race (154 s), vet/build; formato/build web; 74/74 pruebas de navegador. Tras los últimos ajustes de selector vacío, fase/readiness y navegación compacta, también pasaron Go race/vet/build específicos y 10/10 escenarios Kubernetes. Chromium contra una API CoreOps aislada real verificó entrada sin clúster, escritorio/móvil, rechazo de conexión HTTP y ausencia de credenciales Kubernetes en almacenamiento web, sin errores de navegador; la identidad/API temporal se eliminó. No fue una integración contra un clúster Kubernetes vivo.

La API de desarrollo en 8082 se recompiló/reinició conservando entorno, directorio y users/sessions idénticos. Binario `/tmp/coreops-kubernetes-final-api`; log/PID `/tmp/coreops-kubernetes-run/`. Vite sigue en 5173 y el proxy devuelve 401 en las nuevas rutas antes de cualquier acceso al clúster. La entrada Kubernetes → Connections permite configurar el clúster real.
