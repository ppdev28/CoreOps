# Validación: administración y móvil — 2026-11-18

## Alcance

Checkout inicialmente limpio en main. Nuevas cuentas CoreOps en Settings y centro
de energía bajo el menú de usuario; acceso desde toolbar Android. Corrección de
dirección/prioridad del servidor y sesión ligada al API. No cambia contraseña del
usuario, socket Docker, bind del API ni permisos del sistema operativo.

## Comprobaciones

- `go test -race ./...`: correcto, paquete cmd 136 s. Después del ajuste final de
  cooldown, despacho sin probes entre autorización y comando, y fsync del
  directorio de audit, regresiones focalizadas de usuarios/energía/runner con
  race correctas (cmd 8.8 s). `go vet ./...` y build Go correctos; binario fuera
  del checkout.
- Web: `pnpm check:boundaries`, `pnpm format:check`, build y formato adicional de
  nuevos tests/CSS correctos. Playwright: 11 nuevos escenarios específicos y
  suite completa **126/126**, 3.6 min. Se corrigieron selectores de pruebas para
  el nombre accesible del select y los botones con descripción en escritorio.
  Aviso de Node NO_COLOR/FORCE_COLOR sin impacto; sin errores del build.
- Energía: proveedores/runner simulados; 401/403, JSON inválido, confirmación de
  host/boot, revocación antes del despacho, audit no escribible, cancelación,
  repetición concurrente, cooldown y fallo incierto. Argv fijo sin shell/force;
  cancelación de comando y límite de salida. Ningún poweroff/reboot/suspend real.
- Usuarios: creación con viewer por defecto, duplicados, validación, persistencia
  y login tras reabrir el store, admin revocado, respuestas/audit sin passwords.
  UI con confirmación de contraseña, errores, roles y 320/1440 px.
- Integración con binario real, identidad aleatoria aislada y Vite temporal en
  5178: login admin → crear viewer por UI → login viewer y controles restringidos;
  plataforma Android simulada → login por LAN con sufijo API normalizado → centro
  de energía de sólo consulta. Cero errores de JS y cero POST de energía. API,
  Vite e identidad de prueba eliminados. Capturas temporales en
  `/tmp/coreops-administration-integration-lxbzf1xv/`; no son evidencia de APK.
- Android: `pnpm exec cap sync android` correcto; 30 XML válidos y referencias a
  drawable de Kotlin resueltas. `sh -n` para helper/instalador; helper rechaza
  argumentos arbitrarios/extra y consulta no root. No se instaló sudoers.
- Runtime real: API en 127.0.0.1:8082 y Vite en 0.0.0.0:5173. Health por LAN con
  Origin https://localhost devuelve 200 y CORS coincidente; nuevas rutas users y
  host/power sin sesión devuelven 401. Ejecutable de tmux coincide por SHA-256 con
  binario probado; users.json/sessions.json conservan sus hashes antes/después de
  reiniciar únicamente backend. Configuración transferida por archivo privado
  temporal y borrada al arrancar; frontend sin reinicio.

## Límites operativos

La cuenta actual recibe challenge para poweroff/reboot y no para suspend en
logind; la UI no los habilita. `sudo -n` no puede autenticar: un administrador
local debe instalar el helper explícitamente. La contraseña CoreOps no es una
credencial sudo. No se intentó eludir permisos mediante Docker ni se enviaron
señales/órdenes de energía. El helper respeta inhibidores y no garantiza despertar
remoto ni finalización; deduplicación sólo en memoria durante cinco minutos.

Java/SDK Android no están configurados y adb no muestra dispositivos. No se ha
compilado/instalado el APK ni validado WebView físico. El móvil necesita el build
nuevo y el servidor accesible 5173, o un endpoint HTTPS configurado. HTTP,
localStorage y backup nativo conservan riesgos ya documentados para release.
No se probó la contraseña real suministrada ni se reprodujo su valor en archivos.

## Separación de commits

- `2cf3edd` — fix(mobile): bind login sessions to the selected server
- `b0aaf86` — feat(users): create persistent accounts from settings
- `13d57c1` — feat(host): add audited power controls for web and Android

Cada índice funcional se exportó a un directorio temporal y pasó `pnpm build`.
El de usuarios pasó su prueba HTTP/persistencia con race; el de energía pasó
regresiones de núcleo, adaptador y HTTP con race. Estas comprobaciones verifican
que los commits intermedios no dependen de código aún sin registrar. No se
repitió la suite UI completa ya validada: sólo cambió la agrupación en Git.
La documentación de entrega se registra aparte; no se incluyen secretos,
assets generados, identidades de prueba ni binarios.
