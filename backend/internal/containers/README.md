# Contenedores: casos de uso

Este paquete posee list/inspect/start/stop/restart. Sólo depende de la biblioteca estándar. `Runtime` define las cinco operaciones que consume; no devuelve SDKs ni permite comandos genéricos. `Service` valida IDs y acciones antes de delegar y no reintenta mutaciones. Propaga el contexto original.

El adaptador Docker implementa el puerto; `cmd/coreops-api/main.go` compone ambos y `routes.go` aplica los roles existentes antes de invocar HTTP. La autenticación y auditoría no pertenecen al adaptador Docker. No mover permisos a la UI ni añadir un acceso paralelo al runtime sin middleware.

List devuelve una colección vacía explícita. Inspect mantiene soporte de ID/nombre en lectura; las mutaciones sólo aceptan IDs hexadecimales de 12–64 caracteres. `ErrInvalidID`, `ErrInvalidAction` y `ErrNotFound` permiten al transporte elegir status sin depender de Moby.

`Detail` conserva temporalmente metadata compleja como mapas JSON propios para mantener compatible el inspect. No convertirlos en un modelo global de infraestructura ni insertar valores SDK en ellos. Su tipado fino queda para una entrega de contrato posterior.

Pruebas: `go test ./internal/containers`. Cubren que entradas inválidas nunca llegan al runtime, las acciones válidas se ejecutan una vez y errores/contexto se conservan. Ver [arquitectura](../../../docs/architecture.md) y [contrato](../../../api/README.md).
