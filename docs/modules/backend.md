# Backend y capacidades

## Responsabilidad y estado

Un único módulo Go (`backend/go.mod`, Go 1.24), un paquete ejecutable en `cmd/coreops-api`. Mantener el cliente Moby actual. El backend posee todo acceso a Docker, `/proc`, archivos del host y comandos Linux/libvirt.

| Capacidad | Archivos actuales en `cmd/coreops-api` | Límite previsto |
| --- | --- | --- |
| Contenedores | `containers.go` | Casos de uso propios + adaptador Docker |
| Aplicaciones | `applications.go`, `handlers.go` | Agrupaciones Compose y coordinación de contenedores |
| Host y servicios | `host.go`, `services.go`, `handlers.go` | Lectura Linux y acciones systemd |
| Almacenamiento/red | `storage.go`, `network.go` | Información host/Docker; errores parciales explícitos |
| Monitorización/logs | `monitoring.go`, `logs.go` | Muestreos Docker/host, journald y snapshots de logs |
| Máquinas virtuales | `virtual_machines.go` | libvirt mediante `virsh` |
| Seguridad/updates | `security.go`, `updates.go` | Consultas y mutaciones privilegiadas acotadas |
| Terminal | `terminal_session.go`, `terminal.go`, `handlers.go` | PTY/WebSocket admin y endpoints aislados legacy; ver [guía](terminal.md) |

## Instrucciones

Extraer verticalmente cada capacidad según [arquitectura](../architecture.md), empezando por contenedores. Definir interfaces pequeñas en el consumidor; inyectar cliente/ejecutor/reloj cuando permitan probar comportamiento real. Mantener modelos de negocio independientes de HTTP y Moby. No crear interfaces sin consumidor ni abstracciones para proveedores hipotéticos.

Adaptadores validan argumentos y opciones; preferir ejecución por argumentos a shell, excepto el terminal cuya función explícita es ejecutar shell. No reintentar acciones automáticamente. Propagar contexto, limitar salida, tiempos y concurrencia. Diferenciar infraestructura no disponible de lista vacía o estado saludable. Apps deben informar qué acciones parciales se completaron.

`security.go` valida PID numérico y permite sólo `auto-updates` en fix; aún falta verificar que el PID sea una sesión autorizada y que no haya reutilización entre consulta y señal. Revisar validación real antes de declarar ausencias o añadir duplicados.

## Validación

Desde `backend/`: `go test ./...`, `go vet ./...`, `go build ./...`. Ya existen pruebas de auth, roles/auditoría, parsers apt/UFW/eventos y validadores. Faltan pruebas de handlers Docker y errores de integración. Tests unitarios no requieren Docker ni sudo. Integración explícita con contenedor desechable y verificación de estado real, nunca servicios arbitrarios.
