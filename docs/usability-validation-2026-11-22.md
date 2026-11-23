# Validación de mejoras operativas — 2026-11-22

## Alcance

Checkout `develop` inicialmente limpio, sin cambio de rama. Cuatro capacidades:
filtros/logos Applications; bindings agrupables Network; contraseña cifrada de
Terminal con pegado explícito; preferencia de fuente de salida Updates. Se
conservan diseño, rutas anteriores, permisos y workspaces persistentes. No hay
nuevas dependencias Go/JS ni comandos privilegiados. No se solicitó commit/push.

## Evidencia automatizada

- `go test -race ./...`: correcto, cmd 157.4 s; `go vet ./...` y build a
  `/tmp/coreops-nov22-api` correctos. Focalizados nuevos también correctos.
- `pnpm check:boundaries`, `pnpm format:check` y build de producción correctos,
  sin advertencia de tamaño de chunk. Sólo avisos de Node NO_COLOR/FORCE_COLOR.
- Nuevos tests: 8 escenarios en `usability.spec.ts`, 6 en
  `terminal-passwords.spec.ts`; ambos tamaños 320/1440, persistencia de fuente,
  conservación de otros ajustes, búsqueda por imagen/miembros, categorías,
  orden, iconos fallidos/recuperados, grupos, rango inválido y atribución desconocida.
- Password UI: guardar no escribe en PTY; pegar no añade CR/LF; olvidar funciona;
  recarga conserva el estado del servidor sin secreto en localStorage/sessionStorage;
  un reveal que llega tras cambiar pestaña no se envía a ninguna shell; contenido
  con controles se rechaza; error al guardar vacía el input; API antigua se explica;
  viewer no consulta contraseñas. No se usaron secretos del usuario.
- Suite completa: **135/139** iniciales. Las trazas de los cuatro fallos contienen
  `net::ERR_NETWORK_CHANGED` al cargar módulos de React/Vite/Applications; no son
  fallos de una acción de infraestructura. `--last-failed`: **4/4** correctos. Antes,
  una prueba responsive wide tuvo el mismo fallo de carga; pasó en la suite
  completa. No se amplió timeout ni se cambió lógica del producto para ocultarlo.
  Después se corrigió la presentación de filtros activos vacíos tras refresh y
  se añadió una regresión: 8/8 de filtros/fuente correctos en la última versión;
  140 casos distintos cubiertos entre ambas ejecuciones.
- Contratos Go: roles, sesión revocada, cuenta/destino distintos, reapertura,
  concurrencia de stores, identidad borrada/recreada, JSON estricto, control
  characters, clave perdida/no regenerada, permisos inseguros, ciphertext alterado
  y Files bloqueado (preview/ticket/delete por hard link, upload reservado).
- Parser de sockets: TCP/UDP con mismo puerto, IP distintas con mismo protocolo,
  loopback/IPv6, proceso completo, wildcard ambiguo y consulta Docker fallida.
- SVG/PNG: 40 assets locales revisados, fuente fijada en NOTICE, Apache-2.0 incluida.
  Los SVG se parsearon y se excluyeron script, foreignObject, handlers y referencias
  href externas. Assets fuente por debajo de 200 KiB, incluyendo LICENSE/NOTICE; copias de las
  licencias en public se distribuyen también con el build web.

Se corrigieron selectores/nombres accesibles de los controles y la expectativa
inicial de que todos los SVG fueran URLs: Vite puede incrustar pequeños logos
como data:image/svg+xml. Las pruebas comprueban imagen cargada sin depender de CDN.

## Integración real

API propia en loopback:18082 con directorio de identidad temporal, credenciales
aleatorias y Vite temporal:5178. Login admin real; Applications consultó 22 apps y
el inventario Docker; un logo Transmission local cargó. Filtros reales en 320 px
no desbordaron. Network consultó 75 bindings; nombres de proceso comparados con
`ss` real (Node aparecía como MainThread, no se supuso su nombre). Sin cambiar
estado Docker, puertos o firewall.

Una shell wrapper propia fija HOME temporal, HISTFILE=/dev/null y bash sin
dotfiles. Desde Chromium se guardó una contraseña exclusiva de prueba y se lanzó
`read -s` en PTY. La llave envió los 27 bytes esperados sin CR/LF. El read sólo
terminó después de Enter manual; no hubo eco del valor. No apareció en storage
del navegador, JSON cifrado ni audit. Se verificaron clave de 32 bytes/0600,
salida `exit` y cero errores JS. No se escribieron dotfiles/historial del usuario.

Se cerraron API, Vite, PTY y se retiró la identidad temporal. Capturas efímeras en
`/tmp/coreops-nov22-integration-nz89x31a/`. Un primer intento de la prueba asumía
erróneamente nombre node para el proceso; se corrigió la comprobación usando ss,
sin modificar datos del host para que coincidieran.

## Runtime y límites

Se reemplazó únicamente el backend de desarrollo de tmux por
`/tmp/coreops-nov22-runtime-d9jkt3ft/coreops-api`; coincide por SHA-256 con el
binario probado. Configuración transferida por JSON privado eliminado al arrancar;
hashes users.json/sessions.json sin cambios; frontend conservado. Health del proxy
200, rutas protegidas de contraseña/network sin sesión 401. No se creó una
contraseña guardada en la identidad real ni se usaron credenciales previas.

No se ejecutó APT ni se modificó un contenedor/servicio del usuario para validar.
Los permisos/TLS y límites del audit siguen los documentos de seguridad. La clave
del almacén vive junto al estado del servidor, accesible a su cuenta/root: protege
persistencia casual, no un host comprometido ni un admin con terminal. No hay
Keychain/Keystore cliente ni análisis automático de prompts. El programa remoto
puede mostrar/registrar lo pegado; no se afirma que todo prompt sea seguro.

No hubo build/sync Android, Java/SDK configurados o dispositivo adb conectado.
La prueba a tamaño móvil es web; el APK debe recompilarse para los nuevos assets.
