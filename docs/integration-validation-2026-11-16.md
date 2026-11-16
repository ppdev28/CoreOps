# Integración de modularización y capacidades — 2026-11-16

Origen: `refactor/modular-foundation` (`870f3f9`) combinado con `feature/kubernetes-observability`, incluyendo el develop de creación/eliminación, identidad persistente, Compose, Files, logs del host y terminal responsive. Destino solicitado: `develop`.

## Alcance real de la extracción

API OpenAPI inicial y DTOs de lista/inspect/lifecycle; backend `internal/{containers,adapters/docker,transport/httpapi}`; frontend `features/containers` y `shared/{api,platform,ui}`. Auth, Files, logs, Compose, Kubernetes y otras capacidades conservan sus implementaciones incrementales. Crear/borrar contenedores siguen como handlers legacy de backend; su cliente frontend pertenece a la feature. El OpenAPI sigue siendo parcial. No se declara toda la aplicación modularizada.

## Compatibilidad y correcciones

- Se preservan los 47 métodos/rutas autenticadas y sus roles mínimos, además de health/login y el download con ticket. Las rutas posteriores a la rama de refactor no desaparecen.
- SEC-01 permanece intacto: bloqueo, recarga de identidad y revocación. Los fixtures del contrato se persisten antes de probar peticiones, en lugar de asumir la antigua autenticación sólo en memoria.
- Logs y DELETE comparten `containers.ValidID` con la capacidad extraída; no dependen del archivo eliminado `containers.go`.
- Creación/borrado frontend están en la API pública de contenedores. Compose permanece disponible en el mismo diálogo. El listado conserva AbortSignal para logs y otros consumidores.
- Transporte/sesión compartidos son únicos. Fachadas legacy reexportan sus entradas, sin mantener otra implementación ni otra caché de identidad. 401 cierra la sesión compartida; 403 conserva identidad y explica el permiso.
- El modelo de contenedores representa reinicios no medidos como null/— y normaliza colecciones válidas nulas de inspect.
- La prueba de navegación cruzada detectó reconexiones al cargar Containers por primera vez. Files/Terminal quedan fuera del Suspense de rutas; una nueva pantalla no reinicia la PTY ni pierde el directorio de Files.
- Se concilian documentación y dependencias YAML/OpenAPI, sin revertir los controles posteriores ni introducir binarios generados en Git.

## Validación

Resultados: Go race completo (156,6 s), vet/build y `go mod verify` correctos; comprobación CLI Compose explícita correcta. Formato/boundaries/build frontend y 77/77 escenarios de navegador correctos, incluidos los tres tests de la rama modular y navegación Terminal→Files→Containers→Kubernetes. Comandos:

```bash
cd backend
go test -race ./...
go vet ./...
go build -o /tmp/coreops-modular-api ./cmd/coreops-api
go mod verify
COREOPS_TEST_COMPOSE_CLI=1 go test -race ./... -run TestCompose -count=1
cd ../frontend
pnpm format:check
pnpm check:boundaries
pnpm build
pnpm test:ui --retries=1
```

Pruebas reales con API/identidad aisladas y Docker del host: listado → crear → inspeccionar → start/restart/stop → logs → eliminar un contenedor desechable; upload/download de un archivo temporal; fuentes de logs y Kubernetes sin configurar. Compose creó un proyecto de dos servicios parados y otro mediante Chromium/móvil con arranque de Nginx, puertos sólo loopback, rechazo de nombres duplicados y HTTP real. Contenedores, redes, volúmenes e identidad de prueba eliminados. Una segunda prueba Chromium→API aislada→PTY real conservó una variable de shell y el directorio de Files durante navegación cruzada, con una única sesión autenticada y sin errores de navegador; se limpió la API/identidad temporal.

## Límites conservados

No hay un clúster Kubernetes configurado para integración viva: sus consultas/RBAC/mutaciones tienen pruebas TLS/HTTP con un servidor de prueba y escenarios UI aislados. Android/iOS y teclado físico requieren sus toolchains/dispositivos. No se despliega producción, se amplían permisos del host ni se afirma resolver los hallazgos SEC aún abiertos.
