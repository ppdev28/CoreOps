# Adaptador Docker de contenedores

`Containers` implementa `containers.Runtime` mediante el cliente Moby actual. El puerto de casos de uso no importa Moby; sólo este adaptador conoce sus estructuras y opciones.

Lista todos los contenedores, normaliza el prefijo `/` del nombre y traduce puertos/redes. Inspect devuelve los campos ya existentes y realiza un snapshot JSON de mounts/networks/ports: conserva claves, valores y nulos, incluidos metadatos que la UI no conoce, sin pasar objetos SDK a otras capas. Un inspect incompleto devuelve error en lugar de provocar un panic. Los errores de no encontrado se clasifican conservando el mensaje anterior.

La interfaz `ContainerClient` permite probar el adaptador, no ampliar la autoridad del caso de uso. No añadir shell, acceso a HTTP del frontend o reintentos de acciones aquí. Otras capacidades legacy aún usan el cliente Docker desde `cmd/coreops-api`; no se declaran migradas.

Pruebas: `go test ./internal/adapters/docker`. Usan el cliente Moby real contra un servidor HTTP falso y verifican opciones, forma de datos, nulos, metadata, acciones, no encontrado y cancelación. No se conectan al socket real ni mutan contenedores del host.
