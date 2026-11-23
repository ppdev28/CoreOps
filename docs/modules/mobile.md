# Plataforma móvil

## Responsabilidad y estado

Capacitor reutiliza el frontend web. Android añade drawer/toolbar en Kotlin (`MainActivity.kt`); iOS aún necesita validación nativa. Evitar duplicar lógica de infraestructura o reglas de autorización en código nativo.

## Fuentes y archivos locales Android

Los recursos de CoreOps versionados son la referencia: `values/themes.xml` define `AppTheme`, los launcher de cada densidad usan WebP y los iconos adaptativos apuntan a `ic_coreops_*`. `MainActivity.kt` construye el layout programáticamente. No añadir en paralelo los iconos PNG ni `styles.xml` de la plantilla de Capacitor: pueden duplicar recursos existentes.

El 2026-11-13, con autorización del usuario, se respaldaron los 36 archivos Android sin seguimiento y se retiraron 34 restos de plantilla: iconos/splash, layout/configuración sin referencias y tests de ejemplo del paquete `com.getcapacitor.myapp`. Se versionaron los dos `.gitignore`, que excluyen salida de build, configuración local, archivos generados por Capacitor y claves de firma. No ignorar `src/` ni recursos fuente para ocultar conflictos. No se cambiaron archivos nativos previamente versionados ni se ejecutó `cap sync`.

Validación de la limpieza: build web correcto; XML válido, sin recursos duplicados ni referencias XML/Kotlin a recursos ausentes; reglas Git comprobadas para fuentes, generados y claves locales. El intento de `bash ./gradlew --no-daemon :app:assembleDebug` se detuvo por ausencia de Java/JAVA_HOME; este servidor tampoco tiene SDK Android configurado. Quedan pendientes el build nativo y las pruebas en dispositivo con Java 21 y SDK 36 disponibles. El respaldo y su manifiesto SHA-256 están fuera de Git, en `/tmp/coreops-android-cleanup-05romax3/`; es una copia temporal y puede desaparecer al limpiar `/tmp`.

## APK de release firmada

Primera publicación: [android-v0.1.0](https://github.com/ppdev28/CoreOps/releases/tag/android-v0.1.0), commit
`07ca5a2328502267aaec946c5c547969fcd99af5`. APK universal min API 24/target 36, sin debugging ni backup;
verificada con apksigner/zipalign y arranque/login/drawer visuales en emulador aislado.
LintRelease: 0 errores, 12 avisos de mantenimiento. SHA-256 y certificado público
adjuntos; claves/properties fuera de Git con backup local protegido. No se tocó
main remoto ni el debug instalado del Redmi. [Evidencia](../current-state.md).

`assembleRelease`/`bundleRelease` requieren firma explícita; no se genera una
APK unsigned ni se reutiliza la clave debug. El build lee por defecto
`~/.config/coreops/android-signing/release.properties`, o la ruta indicada en
`COREOPS_ANDROID_SIGNING_PROPERTIES`. Propiedades privadas: `storeFile`,
`storePassword`, `keyAlias`, `keyPassword`. Las variables
`COREOPS_ANDROID_KEYSTORE`, `COREOPS_ANDROID_STORE_PASSWORD`,
`COREOPS_ANDROID_KEY_ALIAS` y `COREOPS_ANDROID_KEY_PASSWORD` prevalecen.
Rutas relativas del keystore se resuelven desde el directorio del properties.
No versionar ni adjuntar estos archivos. Conservar backup protegido de clave y
contraseñas: futuras actualizaciones deben mantener la identidad de firma.

Build desde el commit que se va a etiquetar, con dependencias del lockfile:

```sh
cd frontend
pnpm build
pnpm exec cap sync android
cd android
./gradlew --no-daemon :app:assembleRelease :app:lintRelease
# Validar APK con apksigner verify --verbose --print-certs y zipalign -c.
```

Release desactiva debugging y backup Android. Conserva compatibilidad HTTP/LAN
del cliente actual: la primera distribución se publica como prerelease y no
cierra SEC-03 (HTTPS/almacenamiento seguro). La APK usa la API del servidor
configurado en login y no incluye backend ni credenciales. Firmas debug/release
son diferentes: una release no puede sustituir con -r una instalación debug;
no desinstalar/borrar datos automáticamente para probarla. La validación de
release usa un emulador aislado cuando esté disponible.

GitHub: etiqueta específica `android-v0.1.0`, APK, SHA-256 y certificado público.
Publicar sólo la etiqueta no activa el workflow legacy de push a main que puede
resetear/desplegar el checkout del servidor. No hacer push de main como parte de
una entrega de APK ni tocar el checkout remoto de trabajo.

## Flechas y Enter de Terminal — 2026-11-23

La barra web de Terminal separa las cuatro flechas de la tira Esc/Tab/Ctrl.
Hasta 600 px, teclado/atajos y flechas/Enter ocupan dos filas; las direcciones son
siempre visibles y Enter tiene celda propia. En tablet/landscape/escritorio se
mantiene una fila. Iconos Lucide redondeados y controles de 44 px mínimo.
Se conserva la llave de contraseñas y la toolbar nativa sin logo. Reconstruir web,
cap sync Android y APK para incorporar el ajuste; no depende de actualizar Go.

## Actualizar el contenido real de la APK — 2026-11-23

El frontend del Mac estaba detrás del checkout `develop` activo del servidor.
Compilar y hacer cap sync sobre ese código viejo no incorporaba la llave de
Terminal. Se sincroniza una instantánea de código/assets/pruebas/dependencias web
actuales del servidor, conservando el proyecto nativo y los iconos redondeados.
No se cambia de rama ni se copia backend, configuración, usuarios o secretos.
El logo se elimina de la toolbar por petición del usuario; drawer/launcher lo
conservan. La toolbar mantiene título, menú y acceso a cuenta.

Para posteriores APK, comprobar primero que el código fuente incluya las
capacidades de la web. Luego ejecutar secuencialmente `pnpm build`,
`pnpm exec cap sync android`, `./gradlew --no-daemon :app:assembleDebug :app:lintDebug`
desde Android e instalar con `adb install -r`. Verificar que los ficheros de
`dist` coincidan con `android/app/src/main/assets/public` y con los incluidos en
el APK; cap sync por sí solo no descarga cambios del repositorio del servidor.

La llave vive en React (`TerminalPasswordControls`), no en el drawer Kotlin.
Disponible sólo para admin; abre guardado o pega la contraseña guardada sin Enter.
Ajustes permite gestión sin revelar/pegar el secreto. [Contrato y límites](terminal.md).
La API actual del servidor es necesaria: la sincronización frontend no actualiza
el backend Go local ni el servicio remoto. No crear otro almacén local de passwords.

Validado en Redmi real tras instalar la APK reconstruida: logo retirado de
barra superior, interfaz actual y llave con gestión de contraseña existente.
Se abrió/cerró el gestor sin acceder al valor ni mutar el secreto; la prueba de
save/paste/forget se ejecuta con fixtures, no con la contraseña real. Los 85 assets
coinciden en dist/copia Capacitor/APK. Android build y lint pasan (0 errores,
13 avisos); suite web 162/163 inicial y el caso tablet fallido pasa dos repeticiones
sin causa confirmada. Los seis casos Terminal passwords pasan. No se recompila iOS.

## Identidad e iconos — 2026-11-23

La fuente de marca es `frontend/public/favicon.svg`, contrastada con CoreOps web
del servidor: servidores blancos, fondo `#171717`, contorno gris y esquinas suaves.
`ic_coreops_icon` se usa completo en el drawer; la toolbar conserva sólo título,
menú y cuenta. `ic_coreops_logo` conserva el símbolo sin fondo. Launcher adaptativo y monocromo Android 13 mantienen el
símbolo centrado en la zona segura. Fallbacks vectoriales/WebP por densidad,
variante circular e icono PNG local se actualizan juntos. iOS recibe un AppIcon
1024×1024 sin transparencia; no implica compilación/validación en iPhone.

Todos los símbolos del drawer proceden de los mismos Lucide usados en
`components/shell.tsx`, convertidos a VectorDrawable con trazo 2 y terminaciones/
uniones redondeadas. Menu y CircleUserRound completan la toolbar. Se mantienen
IDs, rutas y filtros de color de selección. Licencias en `frontend/licenses/lucide.txt`
y `android/app/src/main/assets/licenses/lucide.txt` dentro del APK.

Regenerar desde frontend después de cambiar el favicon o los símbolos:

```sh
node scripts/sync-native-icons.mjs
pnpm build
pnpm exec cap sync android
cd android
./gradlew --no-daemon :app:assembleDebug :app:lintDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

El generador requiere Chromium de Playwright (`pnpm exec playwright install chromium`
o `COREOPS_CHROMIUM_PATH`); usa React/Lucide/Playwright ya presentes y no añade
una dependencia de runtime. No editar a mano los vectores generados. La copia de
assets de Capacitor sigue ignorada; se versionan los iconos y su licencia.

Comprobación de esta entrega: build/formato/fronteras web y Android
assembleDebug/lintDebug correctos (0 errores, 13 avisos de tooling/recursos/código
existente, incluido el símbolo sin fondo ahora reservado). APK debug actualizada
con `adb install -r` y drawer/toolbar comprobados visualmente en el Redmi Note 8 Pro
conectado. Ajustado el padding de cabecera para evitar recortar el logo.
AppIcon iOS RGB 1024 sin alpha verificado, sin build/prueba iOS. Capturas y APK
previa sólo bajo `/tmp`; no se versionan salidas compiladas.

## Instrucciones

### Login y barra nativa — 2026-11-18

En este entorno tmux, API en `127.0.0.1:8082` y Vite en `0.0.0.0:5173`.
El móvil debe usar `http://192.168.1.128:5173` (o la dirección privada/Tailscale
correspondiente); `http://192.168.1.128:8082` no alcanza un listener de loopback.
Se comprobó health por LAN y CORS para `https://localhost` a través del proxy.
No se amplió el bind ni CORS. Android ya permitía HTTP y mixed content; no se
añadió un parche global de CapacitorHttp ni se cambió esa política.

El servidor elegido en login prevalece sobre `VITE_API_BASE_URL`; se elimina
un sufijo `/api/v1/` pegado en la dirección y se rechazan credenciales, query o
fragmento. La sesión se liga al API absoluto mediante `apiBase`; cambiar de
servidor o detectar una discrepancia borra el token local. Las sesiones antiguas
se migran al API seleccionado al leerlas. Esto no sustituye Keychain/Keystore ni
HTTPS. Los errores de red en 8082 explican el proxy de desarrollo.

El icono de cuenta arriba a la derecha en Android abre el centro de control web
mediante un evento local; contiene las acciones admin y cierre de sesión.
Reconstruir la app para incorporar Kotlin/recursos y los nuevos assets:

```sh
cd frontend
pnpm build
pnpm exec cap sync android
pnpm exec cap open android
# En Android Studio: conectar el móvil y Run.
# Alternativa con Java 21 y SDK 36 configurados:
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Pruebas web simulan plataforma/evento nativo; no equivalen a probar WebView o APK.
En este servidor no hay Java/SDK configurados ni dispositivo adb conectado.

- Mantener una interfaz de plataforma para configuración de servidor y sesión; implementar almacenamiento de credenciales con Keychain/Keystore, no localStorage. Evaluar dependencias antes de elegir plugin.
- Android declara `usesCleartextTraffic="true"` y `allowBackup="true"`. Definir política release con HTTPS y exclusión de secretos de backup; cualquier excepción de desarrollo debe quedar acotada y documentada.
- Asociar token al servidor de autenticación. Validar origen, navegación y puente WebView; no permitir que contenido remoto no confiable invoque funciones nativas.
- Mantener CORS limitado a orígenes realmente usados por Capacitor y web. No resolver fallos añadiendo comodines.
- No modificar ni incorporar archivos nativos sin seguimiento de otras tareas durante la modularización.

## Validación

Settings (2026-11-22): navegación horizontal con selección visible tras cambiar
de ancho, campos apilados, botones/toggles con área táctil de 44 px y acciones de
guardado local accesibles. Tailscale gestiona el servidor, no la VPN del teléfono.
Probado en Chromium a 320/390/768/1024/1440 px y con plataforma/evento Android
simulados; sin cambios Kotlin, cap sync ni prueba de dispositivo físico. Para
llevar los assets a un APK instalado se requiere reconstruir/sincronizar y
compilar en el toolchain Android. Ver [módulo](tailscale.md).

Build web primero; `pnpm cap:sync` sólo como tarea móvil explícita porque modifica proyectos nativos. Después build Android/iOS en sus toolchains, login/logout/expiración, cambio de servidor, HTTPS, atrás/drawer y recuperación de conexión. No declarar validación nativa por haber compilado Vite. Revisar persistencia y backups en un build release.
