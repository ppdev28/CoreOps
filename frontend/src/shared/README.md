# Frontend compartido

- `api/client.ts`: base URL, Bearer, fetch/JSON y errores. Un 401 invalida la sesión; un 403 conserva la identidad y muestra el error. No contiene endpoints de producto ni importa features.
- `platform/session.ts`: única implementación de almacenamiento de sesión y perfil de servidor existente. `lib/auth.ts` reexporta esta instancia: no crear dos cachés/listeners. La persistencia sigue en localStorage; mover el archivo **no resuelve SEC-03** ni la asociación segura de token y servidor.
- `ui/status.ts`: estados genéricos y conversión de estados de ciclo de vida usados por contenedores y aplicaciones; no llama a endpoints.

El resto del diseño compartido sigue en `components/` y `lib/`; no se ha trasladado todo el frontend. No importar `features`, `views` ni fachadas `lib` desde estos módulos. `pnpm check:boundaries` analiza imports/exports con TypeScript y CI lo ejecuta. El contrato `api/typescript/` sólo admite tipos, sin implementación runtime.
