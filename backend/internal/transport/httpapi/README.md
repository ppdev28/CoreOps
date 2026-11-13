# Transporte HTTP / JSON

Contiene los handlers y DTOs HTTP de contenedores y las funciones JSON compartidas. Depende de `containers`, nunca de Docker, adaptadores ni comandos del host. URLs y permisos se registran todavía en `cmd/coreops-api/routes.go`: mantener `viewer` para lista y `operator` para inspect/acciones.

`Containers.List`, `Inspect` y `Action` mapean entradas/resultados y errores. El transporte traduce validación a 400, no encontrado a 404 y fallos del runtime a 502; la autenticación decide 401/403 antes de llegar aquí. Conserva arrays/nulos/casing del contrato y no inventa métricas. Los handlers no reintentan operaciones ni incorporan lógica Docker.

El `http.go` legacy mantiene aliases de `ErrorResponse`, `WriteJSON` y `WriteError` para migrar gradualmente los demás handlers. Auth, CORS, logging, auditoría, router y terminal siguen en el ejecutable; no confundir este primer módulo con una extracción completa del servidor.

Pruebas integradas: desde `backend/`, `go test ./cmd/coreops-api -run 'TestInitialOpenAPIContractAndRealRoutePolicy|TestExtractedModuleDependencies'`. Incluyen middleware real, role enforcement, audit y schema OpenAPI con runtimes falsos. SEC-01 y la política de errores/redacción de SEC-07 siguen pendientes.
