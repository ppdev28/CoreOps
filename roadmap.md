# CoreOps — Roadmap

Revisión del proyecto realizada el 2026-10-22 sobre la rama `capacitor-native`.
Marca `[x]` lo hecho y `[ ]` lo pendiente. Prioridad: **P0** bloqueante/seguridad, **P1** necesario para una v1 usable, **P2** mejora, **P3** futuro.

## 1. Estado actual (resumen)

| Área | Estado |
|---|---|
| Frontend React 19 + Vite 8 + Tailwind 4 (17 vistas, diseño Figma) | Hecho, conectado a API real |
| Backend Go (`backend/cmd/scp-api`, ~1100 líneas, 12 ficheros) | Funcional pero **la rama actual no compila** (ver §2) |
| Docker (listar, inspeccionar, start/stop/restart) | Hecho y validado en servidor real |
| Servicios systemd, VMs (libvirt), almacenamiento, red, monitorización, logs, seguridad (UFW/SSH), updates (apt), terminal | Endpoints implementados; validación real desigual |
| Autenticación / autorización / auditoría | **No existe** |
| Tests (Go y frontend) | **No existen** |
| App móvil (Capacitor Android + iOS, drawer nativo en Kotlin) | Prototipo en curso, sin commitear |
| Documentación (`docs/`) | **Desactualizada** respecto al código |

## 2. Problemas detectados en la revisión (hay que arreglarlos primero)

- [x] **P0 — El backend no compila**: `main.go:93` (cambio sin commitear en `withCORS`) deja el literal del mapa sin coma final → `syntax error`. Además comentó los orígenes de `localhost`/`capacitor://localhost`, así que la app nativa y el dev server local quedan bloqueados por CORS, y se hardcodeó una IP de Tailscale (`100.84.193.37:5173`). Mover todo a `CoreOps_CORS_ORIGINS` con valores por defecto sensatos.
- [ ] **P0 — Ejecución remota de comandos sin autenticación**: `POST /api/v1/terminal/exec` lanza `bash` con el comando que reciba, y `security/fix`, `updates/apply`, `services/*` usan `sudo -n`. Cualquiera con acceso de red a `:8082` tiene shell en el host. Nada de esto debe estar expuesto hasta que exista auth (§3).
- [x] **P0 — El servidor escucha en todas las interfaces** (`Addr: ":8082"`). Hacer bind configurable (por defecto `127.0.0.1` o la IP de Tailscale).
- [x] **P1 — Puerto inconsistente**: el código usa `8082` por defecto, los docs y el proxy de Vite hablan de `8080`. Unificar y documentar.
- [x] **P1 — Variable de entorno `CoreOps_PORT` / `CoreOps_CORS_ORIGINS`** con mayúsculas mixtas; renombrar a `COREOPS_*` (con compatibilidad temporal).
- [x] **P1 — Backend sin formatear**: `gofmt -l` marca 10 de 12 ficheros; `main.go` tiene funciones enteras en una sola línea. Pasar `gofmt` y partir `main.go` (handlers de Docker a `containers.go`, middleware a `middleware.go`, router a `routes.go`).
- [x] **P1 — Nombre `scp-api`** (directorio renombrado a `cmd/coreops-api`; el módulo Go ya era `.../CoreOps/backend`) (Server Control Panel) heredado; renombrar a `coreops-api` junto con el módulo Go (`github.com/ppdev28/CoreOps/backend`).
- [x] **P1 — Cambios sin commitear en la rama**: `.idea/`, `frontend/ios/`, `android/gradle*`, `assets/` sin trackear. Añadir `.gitignore` adecuado (assets generados por `cap sync`, `.idea`, `dist`) y commitear lo demás.
- [ ] **P1 — Dos ramas divergentes** (`feature/kubernetes-observability`, `feature/mobile-responsive`, `terminal-redesign`, `capacitor-native`) sin integrar en `main`. Decidir qué se mergea y cerrar el resto.
- [x] **P2 — `MainActivity.kt`**: `EdgeToEdge.enable` está comentado (parche manual); decidir el comportamiento de insets y dejarlo limpio.
- [ ] **P2 — `frontend/src/index.css` (2125 líneas), `App.tsx` (1158), `shell.tsx`, `ui.tsx`, `DashboardView.tsx` (>1000 líneas)**: trocear cuando se toquen.
- [x] **P2 — `src/imports/pasted_text/server-control-center.md` (1391 líneas)** es material de Figma; mover a `docs/` o eliminar.
- [x] **P2 — `lib/data.ts` (548 líneas de mock)**: comprobar qué vistas siguen usándolo y eliminar el resto (la regla del proyecto es no inventar datos).
- [x] **P2 — Aviso de tamaño de chunk** en el build de Vite: code-splitting por vista (`React.lazy`).

## 3. Seguridad (bloquea cualquier uso fuera de un entorno de pruebas)

- [x] **P0** Autenticación: login local (usuario + contraseña con argon2id/bcrypt) y sesiones por token/cookie `HttpOnly; SameSite`; primer arranque con creación de admin. *(hecho: PBKDF2 + tokens de sesión; usuarios por CLI o `COREOPS_ADMIN_*`)*
- [x] **P0** Middleware de auth en todas las rutas `/api/v1/*` salvo `health`.
- [ ] **P0** Proteger el endpoint de terminal: sólo rol admin, rate limit, timeouts, y a medio plazo sustituir `exec` por PTY sobre WebSocket con registro de sesión. *(parcial: admin-only y auditado; el rate limit de login está hecho; falta PTY/WebSocket)*
- [x] **P1** Autorización por roles (admin / operador / sólo lectura) y mapeo por endpoint. *(viewer/operator/admin)*
- [ ] **P1** Auditoría: registro de quién ejecutó qué acción (contenedor, servicio, update, terminal, fix de seguridad), con persistencia (SQLite) y vista en la UI. *(parcial: backend + `GET /api/v1/audit`; falta la vista en la UI y SQLite)*
- [ ] **P1** Validación de entrada uniforme (ya hay regex para IDs de contenedor, servicios y paquetes apt; falta para VMs, apps, sesiones `pid`, `fix/{item}`).
- [ ] **P1** Cabeceras de seguridad, límites de body y de tiempo en todos los endpoints; CORS estricto.
- [ ] **P1** HTTPS: documentar despliegue con Tailscale Serve / reverse proxy con TLS; sin TLS no usar en red no confiable.
- [ ] **P2** 2FA (TOTP) y bloqueo por intentos fallidos.
- [ ] **P2** Ejecutar el backend como usuario sin privilegios con `sudoers` acotado (lista blanca de comandos) en vez de `sudo -n <cualquier cosa>` / root.
- [ ] **P2** Tokens de API para automatización y para la app móvil (almacenados en Keychain/Keystore).
- [ ] **P3** SSO/OIDC.

## 4. Backend — funcionalidad

### Contenedores
- [x] Listar, inspeccionar, start/stop/restart con validación de ID y errores de Docker.
- [ ] **P1** Logs de contenedor (snapshot + streaming por SSE/WebSocket).
- [ ] **P1** Métricas por contenedor (CPU, memoria, red, I/O) vía `ContainerStats`; mostrar "no disponible" si falla.
- [ ] **P1** Contador de reinicios, healthcheck y fecha de último arranque en inspección.
- [ ] **P2** Eliminar / pausar / renombrar / kill con confirmación reforzada.
- [ ] **P2** Imágenes: listar, pull, prune; volúmenes y redes: listar/crear/eliminar.
- [ ] **P2** Exec/shell dentro de un contenedor (WebSocket + PTY).
- [ ] **P2** Compose/stacks: detectar proyectos (`com.docker.compose.project`), up/down/pull.
- [ ] **P3** Despliegue de contenedores/stacks desde la UI (formulario + YAML).

### Host y sistema
- [x] Host overview, servicios systemd (listar/start/stop/restart), almacenamiento, red, monitorización, logs, updates apt, sesiones y estado UFW/SSH.
- [ ] **P1** Revisar que cada endpoint devuelve `null`/"unavailable" y no valores inventados cuando falla un comando.
- [ ] **P1** Histórico de métricas (ring buffer en memoria o SQLite) para que las gráficas de Monitorización no dependan de un único muestreo.
- [ ] **P2** Logs de journald con filtros (unidad, prioridad, rango) y streaming.
- [ ] **P2** Gestión de reglas UFW (añadir/eliminar) y fail2ban.
- [ ] **P2** Usuarios/grupos y claves SSH.
- [ ] **P2** Tareas programadas (cron/systemd timers).
- [ ] **P2** Gestor de ficheros acotado a rutas permitidas.
- [ ] **P3** Terminal PTY completa (xterm.js) sustituyendo el modelo "un bash por comando".

### Alertas y monitorización
- [ ] **P1** Motor de alertas básico (umbrales de CPU/RAM/disco, contenedor caído, servicio fallido).
- [ ] **P2** Notificaciones: email/webhook/Telegram/ntfy y push móvil.
- [ ] **P3** Integración con Prometheus/Grafana (exportar `/metrics`).

### Plataforma
- [ ] **P1** Capa de configuración (fichero + env vars) y logging estructurado ya iniciado con `slog`.
- [ ] **P1** Almacenamiento local (SQLite) para usuarios, auditoría, alertas y ajustes.
- [ ] **P1** Contrato de API documentado (OpenAPI) y respuestas de error homogéneas con códigos.
- [ ] **P2** Eventos en tiempo real (SSE/WebSocket) en lugar de polling: eventos de Docker, métricas.
- [ ] **P3** Multi-host: agente ligero por nodo + registro de nodos.
- [ ] **P3** Kubernetes (la rama `feature/kubernetes-observability` es el punto de partida).
- [ ] **P3** Proveedores cloud seleccionados.

## 5. Frontend

- [x] UI completa del diseño Figma con 17 vistas y estados de carga/error en las conectadas.
- [x] Acciones de contenedor con estado pendiente, confirmación y refresco.
- [x] **P0** Pantalla de login y manejo de 401 (redirección, expiración de sesión).
- [x] **P1** Configuración de URL del servidor en la app (hoy: `VITE_API_BASE_URL` en build) — pantalla "Conectar a servidor" con validación y guardado seguro. *(campo en la pantalla de login, guardado en `localStorage`; falta almacenamiento seguro en móvil)*
- [ ] **P1** Auditar cada vista: `ContainerDetail.tsx` (973 líneas) y `NativeContainerDetail.tsx` (352) conviven; unificar.
- [ ] **P1** Logs y métricas de contenedor reales en el detalle.
- [ ] **P1** Gestión de errores consistente (toasts + reintento) y estados vacíos.
- [ ] **P1** Tests: Vitest + Testing Library para `lib/api.ts` (adaptadores) y flujos de acciones; Playwright para humo E2E.
- [ ] **P2** Accesibilidad (foco, contraste, ARIA en modales/menús) y teclado.
- [ ] **P2** Responsive: revisar todas las vistas en 360–420 px (rama `feature/mobile-responsive`).
- [ ] **P2** i18n (ES/EN) si se quiere distribuir.
- [ ] **P2** Lint (ESLint) y `format:check` en CI; ahora sólo hay Prettier y oxfmt a la vez — elegir uno.
- [ ] **P2** Realtime: sustituir polling por SSE.
- [ ] **P3** PWA instalable como alternativa/complemento a la app nativa.

## 6. App móvil

Ver análisis en §9. Tareas independientes de la decisión:

- [ ] **P0** Decidir y documentar el camino (§9).
- [ ] **P1** Resolver CORS/URL del backend para `capacitor://localhost` / `https://localhost` / red Tailscale.
- [ ] **P1** Login + almacenamiento seguro del token (Keychain/Keystore).
- [ ] **P1** Android: pulir shell nativo (drawer, insets, botón atrás), icono, splash, firma y build release (AAB).
- [ ] **P1** iOS: verificar que el proyecto SPM compila y arranca; hoy está sin commitear y sin probar según el estado del repo.
- [ ] **P2** Notificaciones push (alertas) y biometría para desbloquear la app.
- [ ] **P2** Modo offline/estado de conexión visible.
- [ ] **P3** Publicación (Play Store / TestFlight) — probablemente innecesaria para uso personal.

## 7. Calidad, CI y despliegue

- [ ] **P1** Tests Go: handlers con cliente Docker simulado (interfaz pequeña), parsers (`parseAptUpgradableLine`, `parseUFWRules`, `classifySecurityEvent`, `detectUFWActive`) y validadores. *(parcial: auth, validadores y parsers; faltan handlers de Docker con cliente simulado)*
- [x] **P1** GitHub Actions (`ci-cd.yml` en `main`: tests, build y despliegue; falta añadir `gofmt`/`go vet`).
- [ ] **P1** `Dockerfile` multi-stage (frontend estático + backend) y `docker-compose.yml` con montaje de socket de sólo lectura donde sea posible.
- [ ] **P1** Unit systemd y script de instalación para Ubuntu. *(parcial: unit en `deploy/coreops.service`; falta script de instalación)*
- [ ] **P2** Servir el frontend desde el propio binario Go (`embed`) → un solo artefacto.
- [ ] **P2** Versionado y releases (binarios linux amd64/arm64).
- [ ] **P2** `.gitignore` para binarios (`backend/scp-api` ya está prohibido en AGENTS.md).

## 8. Documentación

- [ ] **P1** Actualizar `docs/current-state.md` y `docs/codex-handoff.md`: ya no reflejan el código (hay 12+ endpoints más, apps, VMs, terminal, seguridad, rama `capacitor-native`).
- [ ] **P1** Actualizar `docs/architecture.md` (módulos reales, modelo de privilegios).
- [ ] **P1** `AGENTS.md` dice que la rama activa es `feature/project-foundation`; ya no es la real.
- [ ] **P2** `README.md` con instalación, requisitos y capturas.
- [ ] **P2** Modelo de amenazas (qué se expone, qué privilegios usa cada módulo).

## 9. Recomendación: ¿Hotwire Native o seguir con Capacitor?

**Recomendación: quédate con Capacitor.** Cambiar a Hotwire Native sería un rediseño, no una migración.

**Por qué Hotwire Native no encaja con CoreOps hoy**
- Hotwire Native está pensado para apps **renderizadas en servidor** (Rails/Turbo): el servidor devuelve HTML, Turbo navega entre páginas y el shell nativo sólo aporta navegación, pestañas y puentes puntuales. CoreOps es una **SPA React que consume una API JSON en Go**.
- Para aprovecharlo habría que (a) reescribir las 17 vistas como HTML servido por Go (plantillas + Turbo/Stimulus) o (b) meter Turbo dentro de la SPA, lo cual lucha contra React. Se perdería gran parte del trabajo del diseño de Figma, las gráficas de Recharts y el estado cliente.
- Un dashboard operativo es muy interactivo (polling, streaming de logs, terminal, gráficas). Eso es terreno natural de SPA, no de navegación por páginas.
- Hotwire Native exige mantener **dos bases nativas** (Swift + Kotlin) con su propio ecosistema y menos plugins listos que Capacitor. Tú ya tienes Android + iOS generados y un drawer nativo en Kotlin funcionando.
- Para un proyecto de una persona, el coste de oportunidad es alto: semanas rehaciendo lo que ya funciona en lugar de cerrar seguridad, auth y funcionalidad.

**Por qué Capacitor sí encaja**
- Reutiliza el 100 % del frontend; una sola base web para navegador, Android e iOS.
- Plugins para lo que realmente necesitarás: push, biometría, almacenamiento seguro (Keychain/Keystore), estado de red.
- Ya has demostrado que puedes añadir shell nativo (drawer en `MainActivity.kt`) cuando haga falta, que es justo lo que ofrece Hotwire como ventaja.

**Matices honestos**
- El mayor riesgo del enfoque actual no es Capacitor sino que **la app móvil depende de un backend sin auth, accesible por Tailscale**. Eso hay que resolverlo con independencia de la tecnología móvil.
- Si algún día la app debe sentirse más nativa, hay dos opciones intermedias antes de reescribir: más pantallas nativas puntuales (como tu drawer) o React Native. Hotwire Native sólo tendría sentido si migraras toda la UI a HTML del servidor, y no hay motivo de producto para ello.
- Antes de invertir más en la app nativa, considera una **PWA** sobre Tailscale: instalable, sin tiendas, y cubre el caso "comprobar y actuar desde el móvil". Capacitor se justifica cuando necesites push, biometría o mejor integración.

**Siguiente paso concreto**: arreglar el build del backend, añadir login, commitear la rama `capacitor-native`, y luego decidir con una app real y segura en la mano si el shell nativo aporta más que la PWA.

## 10. Orden de trabajo sugerido

1. [ ] Arreglar compilación y CORS (§2), `.gitignore`, commit de `capacitor-native`.
2. [ ] Auth + roles + auditoría (§3) y proteger terminal/acciones privilegiadas.
3. [ ] `gofmt` + dividir `main.go` + tests de parsers y handlers + CI.
4. [ ] Logs y métricas reales de contenedor; alertas básicas.
5. [ ] Empaquetado (Dockerfile / systemd / embed del frontend) y actualización de docs.
6. [ ] Pulido móvil (login, URL de servidor, token seguro, push).
7. [ ] Multi-host, Kubernetes y cloud.
