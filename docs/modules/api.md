# API: contrato y transporte

## Responsabilidad

Mantener la frontera HTTP/JSON para web y móvil: rutas, autenticación/autorización, validación de entrada, DTOs, errores y semántica de acciones. El contrato futuro vivirá en `api/`; los handlers en `backend/internal/transport/httpapi/`. Hoy no existe un OpenAPI ni estas carpetas.

`routes.go` es el inventario ejecutable de métodos y roles; [estado actual](../current-state.md) lo resume. `http.go` contiene JSON/CORS/logging y `handlers.go` muchos handlers. `containers.go` mezcla contrato e integración. Todas estas rutas pertenecen al mismo proceso Go.

La [terminal](terminal.md) añade `GET /api/v1/terminal/session`: upgrade WebSocket y auth admin en el primer frame antes de arrancar la PTY. No usa Bearer en URL. Consultar su guía para protocolo, límites, proxy y caducidad; no tratar el upgrade como acceso anónimo a una shell.

## Instrucciones

- Mantener `/api/v1` y roles al extraer código. Documentar health/login públicos y todos los demás protegidos, incluido logout.
- Validar targets, cuerpo máximo, tipos y acciones antes del caso de uso; mantener defensa también en el adaptador privilegiado. No pasar opciones arbitrarias del usuario a comandos del host.
- DTOs explícitos, sin tipos Moby. El inspect actual incluye estructuras SDK: capturar primero el JSON consumido y sustituirlo de forma compatible.
- Mantener por ahora `{ "error": "..." }`; planificar códigos estables, correlación y errores públicos sin filtrar detalles internos.
- Especificar `null`/ausencia para datos no disponibles. No introducir ceros como sustitutos de mediciones desconocidas.
- Tratar CORS como política del navegador, no autorización. Definir orígenes de producción y confianza del proxy explícitamente.

## Primera entrega y validación

Capturar health, login/logout/me y list/inspect/start/stop/restart de contenedores en OpenAPI; incluir ejemplos sin secretos. Comprobar concordancia con Go y TypeScript mediante pruebas HTTP: 400/401/403/404/502, éxito y cancelación. Probar middleware real con dependencias falsas; no llamar a Docker de producción en tests. Futuras rutas se documentan al migrarlas.
