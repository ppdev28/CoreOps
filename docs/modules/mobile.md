# Plataforma móvil

## Responsabilidad y estado

Capacitor reutiliza el frontend web. Android añade drawer/toolbar en Kotlin (`MainActivity.kt`); iOS aún necesita validación nativa. Evitar duplicar lógica de infraestructura o reglas de autorización en código nativo.

## Fuentes y archivos locales Android

Los recursos de CoreOps versionados son la referencia: `values/themes.xml` define `AppTheme`, los launcher de cada densidad usan WebP y los iconos adaptativos apuntan a `ic_coreops_*`. `MainActivity.kt` construye el layout programáticamente. No añadir en paralelo los iconos PNG ni `styles.xml` de la plantilla de Capacitor: pueden duplicar recursos existentes.

El 2026-11-13, con autorización del usuario, se respaldaron los 36 archivos Android sin seguimiento y se retiraron 34 restos de plantilla: iconos/splash, layout/configuración sin referencias y tests de ejemplo del paquete `com.getcapacitor.myapp`. Se versionaron los dos `.gitignore`, que excluyen salida de build, configuración local, archivos generados por Capacitor y claves de firma. No ignorar `src/` ni recursos fuente para ocultar conflictos. No se cambiaron archivos nativos previamente versionados ni se ejecutó `cap sync`.

Validación de la limpieza: build web correcto; XML válido, sin recursos duplicados ni referencias XML/Kotlin a recursos ausentes; reglas Git comprobadas para fuentes, generados y claves locales. El intento de `bash ./gradlew --no-daemon :app:assembleDebug` se detuvo por ausencia de Java/JAVA_HOME; este servidor tampoco tiene SDK Android configurado. Quedan pendientes el build nativo y las pruebas en dispositivo con Java 21 y SDK 36 disponibles. El respaldo y su manifiesto SHA-256 están fuera de Git, en `/tmp/coreops-android-cleanup-05romax3/`; es una copia temporal y puede desaparecer al limpiar `/tmp`.

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

Build web primero; `pnpm cap:sync` sólo como tarea móvil explícita porque modifica proyectos nativos. Después build Android/iOS en sus toolchains, login/logout/expiración, cambio de servidor, HTTPS, atrás/drawer y recuperación de conexión. No declarar validación nativa por haber compilado Vite. Revisar persistencia y backups en un build release.
