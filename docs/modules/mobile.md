# Plataforma móvil

## Responsabilidad y estado

Capacitor reutiliza el frontend web. Android añade drawer/toolbar en Kotlin (`MainActivity.kt`); iOS aún necesita validación nativa. Evitar duplicar lógica de infraestructura o reglas de autorización en código nativo.

## Fuentes y archivos locales Android

Los recursos de CoreOps versionados son la referencia: `values/themes.xml` define `AppTheme`, los launcher de cada densidad usan WebP y los iconos adaptativos apuntan a `ic_coreops_*`. `MainActivity.kt` construye el layout programáticamente. No añadir en paralelo los iconos PNG ni `styles.xml` de la plantilla de Capacitor: pueden duplicar recursos existentes.

El 2026-11-13, con autorización del usuario, se respaldaron los 36 archivos Android sin seguimiento y se retiraron 34 restos de plantilla: iconos/splash, layout/configuración sin referencias y tests de ejemplo del paquete `com.getcapacitor.myapp`. Se versionaron los dos `.gitignore`, que excluyen salida de build, configuración local, archivos generados por Capacitor y claves de firma. No ignorar `src/` ni recursos fuente para ocultar conflictos. No se cambiaron archivos nativos previamente versionados ni se ejecutó `cap sync`.

Validación de la limpieza: build web correcto; XML válido, sin recursos duplicados ni referencias XML/Kotlin a recursos ausentes; reglas Git comprobadas para fuentes, generados y claves locales. El intento de `bash ./gradlew --no-daemon :app:assembleDebug` se detuvo por ausencia de Java/JAVA_HOME; este servidor tampoco tiene SDK Android configurado. Quedan pendientes el build nativo y las pruebas en dispositivo con Java 21 y SDK 36 disponibles. El respaldo y su manifiesto SHA-256 están fuera de Git, en `/tmp/coreops-android-cleanup-05romax3/`; es una copia temporal y puede desaparecer al limpiar `/tmp`.

## Instrucciones

- Mantener una interfaz de plataforma para configuración de servidor y sesión; implementar almacenamiento de credenciales con Keychain/Keystore, no localStorage. Evaluar dependencias antes de elegir plugin.
- Android declara `usesCleartextTraffic="true"` y `allowBackup="true"`. Definir política release con HTTPS y exclusión de secretos de backup; cualquier excepción de desarrollo debe quedar acotada y documentada.
- Asociar token al servidor de autenticación. Validar origen, navegación y puente WebView; no permitir que contenido remoto no confiable invoque funciones nativas.
- Mantener CORS limitado a orígenes realmente usados por Capacitor y web. No resolver fallos añadiendo comodines.
- No modificar ni incorporar archivos nativos sin seguimiento de otras tareas durante la modularización.

## Validación

Build web primero; `pnpm cap:sync` sólo como tarea móvil explícita porque modifica proyectos nativos. Después build Android/iOS en sus toolchains, login/logout/expiración, cambio de servidor, HTTPS, atrás/drawer y recuperación de conexión. No declarar validación nativa por haber compilado Vite. Revisar persistencia y backups en un build release.
