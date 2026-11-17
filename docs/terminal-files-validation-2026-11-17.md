# Visor de archivos y Terminal Docker — validación 2026-11-17

Trabajo en `develop`, sin cambiar de rama. Los cambios previos de
`docs/development.md` y `scripts/` se conservaron. La preferencia de actualizar
los docs ante cambios muy relevantes queda registrada en `AGENTS.md`.

## Alcance

1. Observability usa Radar en web (sidebar, paleta y cabecera) y un drawable Android
   independiente; Monitoring mantiene su icono.
2. Files abre texto UTF-8 e imágenes PNG/JPEG/GIF/WebP en un visor de sólo lectura.
   Texto hasta 256 KiB con aviso, imágenes hasta 8 MiB, binarios/codificaciones no
   compatibles con descarga. Foco/Escape, wrap/copia, cancelación, no contenido
   activo. Endpoint admin con versión, raíz por descriptor, nofollow final,
   límites y audit de lectura existente sin duplicar registros.
3. Terminal de inspect/menú usa exec TTY real `/bin/sh -i`, usuario de la imagen,
   pestaña persistente independiente del host. Admin antes de Docker; estado e ID
   revalidados. Origen, revocación, cuotas, ACK y audit compartidos. La PTY host se
   encapsula sin perder sus capacidades. El cierre espera a los workers de
   autenticación/entrada antes de dar la sesión por finalizada.

[Files](modules/files.md), [Terminal](modules/terminal.md),
[Observability](modules/observability.md), [Security](security.md).

## Backend

`go test -race ./...`, `go vet ./...` y build fuera del checkout correctos.
Casos de uso validan ID/dimensiones antes del runtime. El cliente Moby real se
prueba contra HTTP/hijack local: opciones no privilegiadas, usuario predeterminado,
TTY sin multiplexar, resize y exit code. Transporte: roles antes del runtime,
estado, bytes, revocación, cierre y auditoría. Files: permisos, HTML literal,
UTF-8, truncado, binarios, imágenes/límites/concurrencia, symlinks/FIFO/traversal,
conflictos y protección de identidad. Las regresiones PTY reales siguen pasando.

## Pruebas de interfaz y compilación

`pnpm check:boundaries`, `pnpm format:check` y `pnpm build` correctos.
Suite completa: 108/110 al primer intento; los dos escenarios previos de
sesión/transporte y logs móvil pasaron al repetirlos aislados (2/2). Después del
ajuste del botón Disconnect terminal, los siete escenarios nuevos de visor y
terminal se repitieron correctamente (7/7). No se afirma una pasada completa sin
reintentos. Los avisos Node de FORCE_COLOR/NO_COLOR son de configuración del runner.

Los nuevos escenarios cubren HTML como texto sin ejecución, imágenes, binarios,
truncado/conflicto, foco/Escape, 390/1440 px, shell host/contenedor independientes,
reutilización de pestaña, estado obsoleto y rechazo operator. Los escenarios PTY
previos cubren más formatos, teclas, búsqueda, zoom y persistencia.

## Comprobación real

Chromium → Vite 5178 → API aislada 18082 → Docker del Ubuntu real. Identidad y raíz
Files temporales, distintas de las del usuario. Contenedor único etiquetado,
imagen local `nginx:alpine`, sin red/puertos/mounts, filesystem read-only, capabilities
eliminadas, no-new-privileges y usuario `65534:65534`. No se descargaron imágenes
ni se ejecutaron acciones sobre contenedores existentes.

Se comprobaron inspect→Terminal, UID 65534, `/dev/pts/0`, dimensiones `stty`, una
variable conservada al navegar y cambiar a 390 px, y `exit 7` reflejado en la UI.
Visor con texto UTF-8/HTML literal y PNG reales, escritorio/móvil; sin errores JS
en la pasada válida. Un intento adicional de navegador no cargó la navegación y
pasó al repetirlo. La comprobación no depende sólo de fixtures.

Capturas temporales en `/tmp/coreops-terminal-files-live-ah4ppg0r/`. No se añaden
capturas, binarios, credenciales ni datos de identidad al repositorio.

## Límites

Cerrar una pestaña Docker desconecta el attach y puede dejar procesos vivos.
El botón y el aviso lo explican: usar `exit` para terminar la shell; no se detiene
el contenedor ni se utilizan señales de PID del host. Imágenes sin `/bin/sh`
no admiten esta terminal. Sin reattach/reintentos de comandos.

No build Android/iOS ni prueba de teclado físico/teléfono. El drawable Android se
validó como XML; Java/SDK no están disponibles. No instalación de servicio de
producción, cambios de permisos, sudo ni despliegue remoto. SEC-02 legacy,
SEC-03/04/06 y otros hallazgos abiertos permanecen documentados.

## Entorno final y limpieza

La API de desarrollo se reconstruyó/reinició en el panel Backend de tmux `coreops`,
con `/tmp/coreops-dev.2dZfh1D5/coreops-api`. Se comparó el entorno completo y los
hashes de `users.json`/`sessions.json`: intactos. Health directo 8082/proxy 5173
correcto; ambas rutas nuevas devuelven 401 sin sesión antes de infraestructura.
Frontend tmux previo conservado; no instalación de servicio. La copia anterior
para rollback y metadatos privados están en `/tmp/coreops-terminal-files-dev-_imgj9om/`.
El snapshot temporal del entorno se borró al arrancar.

El contenedor seguía running tras `exit 7`; sólo se detuvo para comprobar el rechazo
409 de Terminal. Se verificaron su ID/nombre/etiqueta antes de stop/remove. Contenedor
retirado, token de prueba revocado, API/Vite aislados detenidos e identidad/archivos
/config de prueba eliminados. Sólo se conservan logs/capturas temporales. Sin commit,
push, cambios de servicios del host ni contenedores existentes.
