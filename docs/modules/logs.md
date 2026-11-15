# Logs

## Estado y diseño

La vista de Logs en `develop` (2026-11-15) recrea el espacio de lectura de Dozzle con la identidad visual de CoreOps: lista lateral de contenedores reales, pestañas, comparación de dos fuentes, búsqueda literal con case/exclusión, niveles, filas monoespaciadas alternas, timestamps UTC, JSON expandible, copia, descarga, salto al final y modo foco. Referencia: instalación local de Dozzle v10.6.5 y [Dozzle](https://dozzle.dev/). No se importa código/branding de Dozzle ni se conecta el navegador al Docker socket.

- `frontend/src/views/LogsView.tsx`: catálogo, hasta ocho pestañas, selección/comparación y controles. Desde Containers → Logs o el botón Logs de inspect se abre el contenedor seleccionado.
- `frontend/src/components/LogPane.tsx`: snapshot, pausa, cancelación, caché en memoria por fuente, filtros y filas. Sólo los dos paneles visibles pueden refrescarse. La carga diferida tiene su propio Suspense para no reiniciar las PTY abiertas.
- `frontend/src/lib/logs.ts`: tipos de selección, limpieza lineal de escapes de terminal y exportación. Logs/HTML/OSC se muestran como texto; nunca usar `dangerouslySetInnerHTML` o ejecutar enlaces/comandos del contenido.
- `frontend/src/styles/logs.css`: estilos aislados y temas CoreOps. Selector de fuentes en drawer móvil; comparación vertical en tablet/móvil, horizontal en escritorio; modo foco sale con Escape.
- `backend/cmd/coreops-api/logs.go`: lecturas Docker/journal, DTOs propios, parser y límites. Sigue dentro del ejecutable actual; no es una extracción a `internal/` ni un servidor nuevo.

## Contrato y permisos

Todas las rutas exigen **operator o admin**. Viewer no inicia lecturas de logs desde la UI; el backend sigue siendo la autoridad.

- `GET /api/v1/logs`: agregado compatible, hasta 500 registros y catálogo de nombres de fuentes. Incluye warnings cuando una fuente no se puede leer.
- `GET /api/v1/logs?source=system`: sólo journal de la cuenta del servicio, últimos 300 registros. Si no se puede leer, devuelve 502 con error visible. No eleva privilegios.
- `GET /api/v1/containers/{id}/logs?tail=500`: ID hexadecimal validado, tail 1–1000, inspección real para identificar el contenedor y snapshot de stdout/stderr/TTY. 400 entrada inválida, 401/403 permisos, 404 inexistente, 502 lectura/driver no disponible.

Se conserva `{entries,sources,updatedAt}`; se añaden `warnings?`, `truncated?` y `entry.stream?`. `updatedAt` indica la lectura del snapshot. El timestamp del registro procede de Docker/journal; si falta se devuelve vacío y se muestra `—`. Mensajes conservan espacios/indentación. Niveles del journal usan PRIORITY; niveles Docker se extraen de JSON (`level`, `severity`, `log.level`) o se infieren del mensaje. No confundir inferencia con un nivel declarado por la aplicación.

## Actualización y límites

Es **polling de snapshots**, sin SSE/WebSocket ni búsqueda persistente de historial. Resume activa lecturas con una espera de 2 s tras cada respuesta. Pause aborta lecturas pendientes y conserva la vista; Refresh solicita una lectura manual. Al ocultar la pestaña del navegador se suspenden las lecturas de paneles. El estado inicial respeta `autoRefresh` de CoreOps; el botón permite reanudar explícitamente. El catálogo se actualiza cada 15 s mientras el seguimiento está activo.

Cada contenedor: máximo 2 MiB de lectura, 64 KiB por línea y buffer de 1000 registros; el tail solicitado reduce ese resultado. El parser soporta frames Docker fragmentados y TTY sin inventar timestamps. Se señalan truncamientos. El agregado conserva sólo los 500 más recientes y limita concurrencia Docker a cuatro lecturas; deadline de 12 s. La lectura dirigida usa deadline de 10 s. El driver de logs debe soportar lectura. Journal limita stdout a 2 MiB y falla explícitamente si supera ese tamaño.

Descarga/copia exportan sólo las líneas visibles tras filtrar el buffer, no todo el historial del contenedor. Pause, filtros y seguimiento no cambian ni borran logs del host. La caché se limita a las pestañas abiertas y vive en memoria de la vista; logout/desmontaje la descarta. No añadir persistencia de contenido de logs en localStorage.

## Validación

`go test -race ./...`, `go vet ./...`, `go build ./...`; `pnpm format:check`, `pnpm build`, `pnpm test:ui` desde frontend.

`logs_test.go` prueba frames stdout/stderr fragmentados, TTY, timestamps/espacios reales, límites, niveles estructurados, journal simulado, roles/revocación, consulta Docker y errores. `logs.spec.ts` cubre selección/pestañas/comparación, pausa, filtros/JSON, XSS/ANSI/OSC como texto, copia/descarga filtrada, fallos con caché, roles, modo foco y 320px. La prueba de terminal incluye navegación a Logs sin recrear conexiones.

Se comparó un snapshot real con `docker logs --timestamps`, incluyendo mensajes/streams y timestamp; Chromium verificó acceso desde Containers, polling/pausa y temas oscuro/claro/móvil mediante una API aislada de sólo lectura. No se crearon/modificaron contenedores para estas pruebas. La suite completa contiene 42 pruebas y pasó, además de regresiones posteriores acotadas para ajustes visuales. No se compiló Android/iOS.
