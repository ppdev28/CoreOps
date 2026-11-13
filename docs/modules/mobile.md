# Plataforma móvil

## Responsabilidad y estado

Capacitor reutiliza el frontend web. Android añade drawer/toolbar en Kotlin (`MainActivity.kt`); iOS aún necesita validación nativa. Evitar duplicar lógica de infraestructura o reglas de autorización en código nativo.

## Instrucciones

- Mantener una interfaz de plataforma para configuración de servidor y sesión; implementar almacenamiento de credenciales con Keychain/Keystore, no localStorage. Evaluar dependencias antes de elegir plugin.
- Android declara `usesCleartextTraffic="true"` y `allowBackup="true"`. Definir política release con HTTPS y exclusión de secretos de backup; cualquier excepción de desarrollo debe quedar acotada y documentada.
- Asociar token al servidor de autenticación. Validar origen, navegación y puente WebView; no permitir que contenido remoto no confiable invoque funciones nativas.
- Mantener CORS limitado a orígenes realmente usados por Capacitor y web. No resolver fallos añadiendo comodines.
- No modificar ni incorporar archivos nativos sin seguimiento de otras tareas durante la modularización.

## Validación

Build web primero; `pnpm cap:sync` sólo como tarea móvil explícita porque modifica proyectos nativos. Después build Android/iOS en sus toolchains, login/logout/expiración, cambio de servidor, HTTPS, atrás/drawer y recuperación de conexión. No declarar validación nativa por haber compilado Vite. Revisar persistencia y backups en un build release.
