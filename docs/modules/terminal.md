# Terminal interactiva

Implementada en `feature/terminal-redesign` (2026-11-13). Es una terminal remota Linux con PTY real; no ejecuta comandos en el Mac o teléfono del cliente ni instala una aplicación de escritorio.

## Responsabilidades

- `backend/cmd/coreops-api/terminal_session.go`: transporte WebSocket, autorización, límites, PTY, shell y cierre. Permanece en el paquete actual; no supone una extracción a `internal/`.
- `auth.go`: validación del hash de sesión durante la conexión, sin conservar el Bearer en la sesión PTY.
- `frontend/src/lib/api.ts`: URL según el mismo servidor/base API del resto de la app; autenticación inicial dentro del WebSocket.
- `frontend/src/views/TerminalView.tsx`: pestañas, xterm.js, ajuste de dimensiones, búsqueda, selección/copia, atajos y teclado auxiliar móvil.
- `frontend/src/styles/terminal.css`: apariencia con tokens compartidos. `App.tsx` mantiene la vista montada al navegar, hasta cerrar sesión.

Cada pestaña mantiene su propia shell y estado: directorio, variables, aliases, historial/readline y control de trabajos. ANSI/VT, colores, pantalla alternativa, aplicaciones interactivas, entrada sin eco, pegado y señales pasan por la PTY. El historial/autocompletado dependen de la shell y sus dotfiles, no de una simulación JavaScript. Los programas deben estar instalados y permitidos en el servidor.

La shell predeterminada es `/bin/bash -l`, en el home de la cuenta que ejecuta la API. `COREOPS_TERMINAL_SHELL` permite otra ruta absoluta de shell compatible con `-l`. Se crea un entorno explícito (HOME/USER/LOGNAME/SHELL/PATH, TERM=xterm-256color, COLORTERM=truecolor y locale/zona horaria); no se heredan variables de credenciales de la API. La shell puede cargar su configuración personal.

## Contrato WebSocket v1

`GET /api/v1/terminal/session`. Sin cabeceras de upgrade es una comprobación autenticada con Bearer, exclusiva de admin, que devuelve `{ "available": true, "protocol": 1 }`, con no-store y sin crear procesos. La UI la consulta antes de montar xterm; un 404 muestra la instrucción de recompilar/reiniciar la API, con botón Retry connection. Con upgrade WebSocket requiere **admin** antes de crear cualquier proceso. A diferencia de las rutas JSON, el navegador autentica en el primer mensaje, dentro de un plazo de 5 s. Nunca enviar el Bearer en URL, query, subprotocolo o logs.

| Dirección | Mensaje | Semántica |
| --- | --- | --- |
| Cliente → servidor, texto JSON | `{ "type": "auth", "token": "<session>", "cols": 80, "rows": 24 }` | Primer mensaje obligatorio |
| Servidor → cliente, texto JSON | `{ "type": "ready", "user": "…", "host": "…", "shell": "/bin/bash" }` | Identidad real del proceso, distinta del usuario de CoreOps |
| Ambas, binario | Bytes UTF-8/VT de entrada o salida | Sin filtrado de ANSI ni interpretación de comandos |
| Cliente → servidor, texto JSON | `{ "type": "resize", "cols": 100, "rows": 30 }` | Aplica TIOCSWINSZ/SIGWINCH; 2–500 columnas, 1–250 filas |
| Cliente → servidor, texto JSON | `{ "type": "ack" }` | Una confirmación por bloque binario **procesado por xterm**, no sólo recibido |
| Servidor → cliente, texto JSON | `{ "type": "exit", "code": 0 }` | Salida natural de la shell |
| Servidor → cliente, texto JSON | `{ "type": "error", "message": "…" }` | Error público; no hay reintento automático |

Se mantienen las rutas admin `POST /terminal/exec` y `/terminal/complete` para compatibilidad. La nueva UI no las usa. Conservan sus limitaciones de ejecución aislada y salida en memoria; no confundirlas con la PTY. El audit de `/exec` ahora redacta el comando.

## Seguridad y ciclo de vida

- Validación exacta de Origin antes de upgrade: mismo origen directo, orígenes locales existentes de desarrollo/Capacitor o `COREOPS_CORS_ORIGINS`. Sin comodines ni confianza en X-Forwarded-Host/Proto. Configurar explícitamente el origen HTTPS externo al usar un proxy.
- 32 conexiones globales, incluidas las pendientes de auth; cuatro PTY por usuario admin. Primer frame en 5 s; frames de entrada hasta 32 KiB; salida en bloques de 8 KiB, máximo ocho sin ACK (64 KiB). El scrollback del cliente está limitado a 5.000 líneas. Ping cada 20 s y plazo de lectura/pong de 60 s; escritura WebSocket de 10 s. El cliente divide pegados en 16 KiB y corta una conexión con más de 1 MiB pendiente de enviar.
- Revalidación de sesión/rol antes de cada entrada y cada segundo en reposo. Logout, caducidad o cambios **en el mismo AuthStore del servidor** cierran la conexión. SEC-01 sigue pendiente: los cambios del CLI externo requieren parar/reiniciar el servicio.
- Cerrar pestaña, desconectar o apagar la API termina la shell y su grupo de procesos en primer plano, cierra la PTY y recoge el proceso. La pestaña conserva la salida visible tras desconectar, sin reenviar comandos ni reconectar automáticamente. La navegación interna conserva sesiones; recargar/cerrar la app las termina. La advertencia beforeunload depende del navegador.
- Procesos separados deliberadamente con nohup/disown/setsid o un multiplexor externo pueden sobrevivir, como en una terminal convencional. No es una frontera de aislamiento ni un gestor de tareas del host.
- Audit registra apertura, cierre y denegación de auth con usuario, rol y remoto; no contenido, contraseñas ni comandos. El append sigue teniendo las limitaciones de SEC-06. OSC 52 del remoto se bloquea; copiar requiere selección y acción del usuario. Los enlaces requieren Ctrl/Cmd+clic y sólo abren HTTP(S).
- Usar HTTPS/WSS en acceso remoto. La cuenta del servicio conserva su autoridad sobre el host y Docker; no hay suplantación de usuarios Linux, sandbox, agente SSH del cliente ni elevación nueva. Los riesgos SEC-01/03/04 permanecen abiertos.

## Interacción y configuración

El teclado se envía a la shell: Enter, Tab, flechas, Ctrl+C/D/Z/L/R/K, etc. Ctrl+Shift+C copia una selección; Cmd+C también. Cmd+K limpia el scrollback; Ctrl+Shift+F/Cmd+F abre búsqueda. Ctrl+PageUp/PageDown cambia de pestaña. Ctrl+Shift+T/W abre/solicita cerrar pestaña cuando el navegador entrega esos atajos. Botones equivalentes permiten operar sin atajos reservados por el navegador. El pegado usa el evento nativo del navegador y el bracketed paste de xterm. Portapapeles programático requiere contexto seguro y permiso del navegador; el comando Copy del navegador sigue disponible.

Diseño flexible, ResizeObserver y visualViewport ajustan la PTY al contenido, orientación y teclado móvil. Los botones auxiliares incluyen Escape, Tab, Ctrl+C/D/Z/L, flechas y Enter. No se ha validado un teclado físico/móvil real, ni se han recompilado los proyectos nativos Capacitor. Una web no replica todos los menús/atajos reservados de GNOME Terminal o macOS Terminal.

El proxy de desarrollo Vite permite WebSockets y conserva el Host original (`changeOrigin: false`), de modo que Origin y Host coinciden al entrar por IP LAN o Tailscale. No reescribir Origin ni ampliar su lista a comodines para resolver fallos de proxy. En producción, el proxy debe reenviar `/api/v1/terminal/session`, hacer upgrade WebSocket y permitir conexiones largas. Ejemplo Nginx dentro del servidor HTTPS existente:

```nginx
location /api/v1/terminal/session {
    proxy_pass http://127.0.0.1:8082;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

Configurar `COREOPS_CORS_ORIGINS=https://coreops.example` con el origen real. No hace falta ampliar ReadTimeout/WriteTimeout del servidor HTTP: la conexión se gestiona después del upgrade. No se modificó el proxy de producción ni el servicio instalado. Se actualizó el proceso de API de desarrollo de 8082 conservando su entorno, directorio de trabajo y archivos de identidad; el proceso antiguo no incluía el endpoint de terminal.

## Validación

```bash
cd backend
go test -race ./...
go vet ./...
go build ./...
cd ../frontend
pnpm format:check
pnpm build
pnpm test:ui
```

`terminal_session_test.go` usa WebSocket y PTY reales con una shell de prueba sin dotfiles/historial del usuario: persistencia, TTY, dimensiones, Ctrl+C, entrada oculta, exit code, orígenes, roles, caducidad inicial/activa, logout, límites, salida masiva y apagado. Las pruebas Playwright de terminal interceptan WebSocket: teclas, pestañas, navegación, búsqueda, resize, salida y denegación por rol; las pruebas generales cubren ocho tamaños desde 320px a 2560px.

Validación real adicional de esta entrega: Chromium → API aislada → PTY de este Ubuntu, con estado persistente, Ctrl+C, `top` interactivo, pestañas independientes, resize móvil/escritorio, conexión de más de 45 s y logout. Sin mutaciones Docker ni del servicio instalado. No representa una prueba de todos los programas TUI, shells, proxies o plataformas nativas.

Referencias: [xterm flow control](https://xtermjs.org/docs/guides/flowcontrol/), [xterm security](https://xtermjs.org/docs/guides/security/), [creack/pty](https://github.com/creack/pty).

## Regresión: cursor vacío y Disconnected

El 2026-11-13 se reprodujo un 404 del endpoint a través del frontend activo: el proceso Go de desarrollo seguía ejecutando un binario anterior a la feature. La nueva UI no puede incorporar rutas en un backend ya iniciado; hay que recompilar/reiniciar el proceso al cambiar código Go. Health por sí solo no prueba que la versión soporte PTY.

Tras actualizar ese proceso y conservar Host en Vite, se verificó upgrade 101 por localhost, IP LAN y Tailscale, y 403 desde un Origin ajeno. Chromium → Vite → API aislada → `/bin/bash -l` predeterminado mostró el prompt real usuario@hostname y ejecutó comandos persistentes. Los tests Go incluyen disponibilidad por rol sin procesos y arranque lento de shell. Las 20 pruebas Playwright incluyen API antigua, instrucción de reinicio/reintento y fallo de upgrade; antes del handshake se distingue el error de proxy/Origin de una desconexión de una shell ya establecida. Se eliminó el texto duplicado Disconnected.
