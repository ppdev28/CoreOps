# Terminal interactiva

## Contraseña guardada y pegado explícito — 2026-11-22

La toolbar añade una llave para guardar una contraseña; una vez guardada, la misma
llave la pega en la pestaña activa **sin Enter**. El botón de ajustes permite
reemplazar, refrescar estado u olvidar. Guardar no envía bytes a la PTY. Nunca se
copia al portapapeles ni se persiste el valor en localStorage/sessionStorage.
El diálogo no precarga la contraseña existente. La app no intenta reconocer un
prompt: el usuario debe comprobarlo, porque una shell/programa remoto puede
mostrar o registrar lo pegado. Esto tampoco configura sudo, usuarios Linux o SSH.

Cada contraseña pertenece al usuario CoreOps y al target explícito: `host` o
`container-<ID>`; las pestañas del mismo target comparten su valor. Una shell host
puede ejecutar SSH hacia otro equipo: el target de guardado sigue siendo la shell
CoreOps, no un destino SSH descubierto. IDs cortos/completos diferentes son targets
distintos; la UI usa el ID recibido del inventario. Cambiar pestaña/servidor/usuario,
ocultar Terminal o cerrar sesión aborta el pegado pendiente y limpia el formulario.
Un guard comprueba además la pestaña/destino actuales y una conexión viva antes de
usar `xterm.paste`. Los secretos con saltos de línea o controles se rechazan tanto
en servidor como en cliente; no se añaden comandos, framing manual ni Enter.

API sólo admin, con revalidación bajo el bloqueo persistente de identidad:

- GET `/api/v1/terminal/passwords/{target}`: sólo `{saved}`.
- POST a esa ruta: JSON estricto `{password}`, máximo 4 KiB; 1–1024 bytes UTF-8
  sin caracteres de control/saltos de línea.
- POST `.../{target}/reveal`: devuelve el valor únicamente tras la acción explícita.
- DELETE `.../{target}`: olvida el valor de ese usuario/destino.

No admite queries o parámetros de shell. Respuestas no-store/private; sin reintento
automático. Audit registra actor, acción y target, nunca valor/cuerpo ni texto
pegado; conserva los límites existentes de durabilidad del audit HTTP. 404 al
consultar estado puede indicar API antigua: reconstruir/reiniciar backend.

`terminal_passwords.go` guarda AES-256-GCM con nonce aleatorio y AAD que liga cuenta
(incluida su fecha de creación) y destino. No comparte secretos entre admins ni
con una cuenta borrada/recreada con el mismo nombre. Usuarios legacy sin fecha
usan su hash de autenticación como identidad de generación; cambiar su password
invalida el acceso a esos registros antiguos. Un máximo de 512 registros cifra el
estado global; entradas de cuentas eliminadas pueden quedar cifradas e inaccesibles
hasta mantenimiento del almacén. No es una bóveda de extremo a extremo.

Archivos en `COREOPS_DATA_DIR`: `terminal-passwords.json` y
`.terminal-passwords.key`, ambos 0600, propiedad de la cuenta API, sin symlink.
Se crean sólo al guardar y se actualizan bajo el mismo flock que HTTP/CLI. El
JSON usa persistencia atómica/fsync; la clave también se sincroniza. Al perder una
clave con registros existentes o detectar corrupción/permisos inseguros se falla
cerrado, sin regenerarla ni borrar contraseñas automáticamente. Respaldar clave y
datos juntos, protegiendo también la identidad. El cifrado no protege contra root,
compromiso de la cuenta API o un admin con acceso a su shell/sistema de archivos.
No sustituye HTTPS/WSS para transportar secretos ni Keychain/Keystore del cliente.

Files rechaza vista previa, download-ticket y borrado de los dos archivos,
incluidos hard links; también bloquea uploads a sus nombres en el directorio
privado. No implica aislamiento frente a la terminal privilegiada. Tests de
`terminal_passwords_test.go` cubren permisos, revocación, cuentas/targets, reinicio,
concurrencia, corrupción/clave perdida y protección Files. Playwright verifica
ausencia de Enter, almacenamiento local, cambio de pestaña y errores. Usar sólo
contraseñas/cuentas de prueba en una API aislada para validar la PTY real.

## Terminal de contenedores — 2026-11-17

El botón Terminal de inspect y el menú de contenedores abren una pestaña con el
nombre del contenedor en el workspace existente. Sólo admin; inspect la desactiva
si no está running. Las pestañas del host y contenedor conservan estado al navegar
y comparten límites globales/por usuario, Origin exacto, auth inicial,
revalidación de revocación, control de flujo y teclado responsive existentes.

`GET /api/v1/containers/{id}/terminal`: sin upgrade comprueba capacidad/estado sin
crear exec (Bearer admin, 400 ID/query inválido, 404 ausente, 409 parado/pausado,
503 runtime no disponible); con upgrade usa el mismo protocolo WebSocket v1 y
autentica antes de acceder a Docker. Audit de apertura/cierre/denegación con ID,
sin entrada/salida/tokens. No se envía Bearer en URL ni comando desde el cliente.

`internal/containers/terminal.go` define el puerto y la sesión independiente de SDK;
`internal/adapters/docker/terminal.go` usa inspect/exec-create/attach/resize/inspect.
Se ejecuta `/bin/sh -i` con TTY, usuario y directorio predeterminados del contenedor,
sin privileged ni override de usuario ni entorno del proceso CoreOps. La imagen
debe incluir `/bin/sh`; no se instala una shell ni se inicia el contenedor por
abrir Terminal. La UI muestra errores si cambia el estado entre inspect y exec.
La PTY host se encapsula en `terminal_host.go` y conserva su cierre de procesos.

**Cerrar una pestaña de contenedor desconecta el attach. Docker exec no ofrece
una operación de kill por exec ID: la shell/procesos pueden continuar dentro del
contenedor. Usar `exit` para terminar la shell antes de cerrar.** El aviso de cierre
lo explicita; no se detiene el contenedor ni se señalizan PIDs del host.
La revocación corta el transporte y toda entrada posterior; no revierte comandos
ya aceptados. No hay reattach ni reintento automático. SEC-02 legacy/03/04/06
siguen abiertos.

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

## Ajuste responsive — 2026-11-15

Implementado en `feature/kubernetes-observability`, manteniendo la rama y el protocolo/roles del backend. La barra de pestañas permanece en una sola fila: en móvil las herramientas pasan a un popover accesible; la pestaña activa y su cierre se desplazan a la vista. Los controles táctiles tienen un mínimo de 44 × 44 px. Enter y el botón de teclado permanecen fijos mientras Esc/Tab/Ctrl/flechas se desplazan horizontalmente. Copia, búsqueda, limpieza y zoom siguen disponibles en todos los tamaños.

Móvil/puntero táctil no enfoca el input al abrir o cambiar de shell, evitando solicitar el teclado automáticamente. El botón de teclado alterna foco/blur; la apertura/cierre físico del teclado sigue dependiendo del navegador/SO. Las teclas auxiliares conservan el estado de foco y no lo fuerzan. Se desactivan autocapitalización, autocorrección y spellcheck. El input de búsqueda mantiene 16 px para evitar zoom automático de iOS.

La fuente local monoespaciada carga antes de medir xterm. Fuente inicial de 12/13/14 px según el ancho disponible; zoom manual por pestaña, conservado al rotar/redimensionar. Una superficie interna sin padding evita incluir márgenes en las dimensiones y recortar la última fila. `ResizeObserver`, carga de fuentes y `visualViewport` agrupan ajustes por frame; sólo se ajustan paneles visibles y sólo se envía resize cuando cambian filas/columnas, dentro de los límites existentes (500 × 250). La barra de estado muestra las dimensiones reales del emulador.

El viewport visual reduce la altura y compensa el desplazamiento al abrir el teclado, sin interceptar el pinch zoom. El modo foco usa el viewport disponible sin la navegación de la app, conservando las sesiones. Su menú sigue por encima del panel. Escape sale de ese modo cuando el foco está en controles; **dentro de la terminal sigue llegando a Vim/TUI**, y dentro de búsqueda cierra la búsqueda. El botón explícito permite salir siempre. No se usa una API de pantalla completa que requiera permiso.

Validación: formato/build web; 57 pruebas de interfaz (las 12 nuevas cubren ocho tamaños 320–2560 px, cuatro sesiones, teclado/foco, controles, búsqueda/zoom, viewport visual simulado, orientación y modo foco). La suite completa necesitó un reintento de un test existente de navegación a Containers; la repetición aislada pasó. Regresiones de terminal y `go test -race ./... -run TestTerminal -count=1` correctas. Verificación adicional con Chromium → API aislada → PTY real sin dotfiles/historial del usuario: `stty size`, variable persistente al rotar/mover a escritorio, pantalla alternativa y una sola sesión autenticada. Se limpiaron API, shells e identidad temporales. No hay validación en un teléfono físico ni compilación nativa Android/iOS.
