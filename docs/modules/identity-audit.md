# Identidad y auditoría

## Estado y responsabilidad

`auth.go` implementa usuarios, roles, contraseñas PBKDF2-SHA256 (600 000 iteraciones), sesiones opacas aleatorias con hash SHA-256 en servidor y TTL de 12 h por defecto. `routes.go` impone viewer/operator/admin. `users_cli.go` gestiona usuarios fuera del HTTP. `audit.go` registra mutaciones, intentos de login y rechazos; GET no se registra.

Persistencia JSON en `COREOPS_DATA_DIR`, con permisos 0700/0600, temporal único, fsync y rename. Desde 2026-11-15, `auth_persistence.go` usa flock sobre `.identity.lock` y recarga ambos archivos en cada operación de CLI/servidor. Login verifica de nuevo el hash/rol después del cálculo PBKDF2. Password/borrado persisten primero la revocación; si la escritura posterior falla, pueden quedar sesiones revocadas aunque el cambio de usuario no se haya completado. No hay transacción general entre archivos. Logout devuelve 503 si no puede persistir. Los fallos de lectura rechazan autenticación en vez de usar memoria antigua. No se cambia el formato de datos ni se añade una base de datos.

## Instrucciones

Desde 2026-11-18, Settings → Users permite a un admin listar/crear cuentas CoreOps
(no usuarios Linux), mediante GET/POST `/api/v1/users`. El rol predeterminado es
viewer; admin/operator/viewer son explícitos. Sólo se devuelve nombre/rol, nunca
hashes ni passwords. POST usa JSON estricto de 8 KiB, nombre de 1–32 caracteres,
password de 10–1024 bytes y máximo dos cálculos PBKDF2 simultáneos para creación
HTTP. Duplicados devuelven 409. La sesión admin se vuelve a verificar bajo el
mismo bloqueo de identidad, después del hash y antes de persistir, conservando
la convivencia CLI/servidor. Ante fallo incierto, refrescar la lista antes de
reintentar. Cambio de contraseña, rol y borrado siguen por CLI.

Tests HTTP/persistencia y auditoría en `administration_test.go`; UI en
`administration.spec.ts`.

- Mantener el bloqueo de archivo y recarga en cada operación; un mutex de proceso no basta. No borrar/reemplazar `.identity.lock` durante la ejecución. Todos los procesos deben usar la versión actual y un filesystem local con flock/rename/fsync; no ejecutar simultáneamente binarios anteriores.
- Preservar formatos o diseñar migración y recuperación; nunca perder usuarios o aceptar sesiones revocadas por fallo de disco.
- Probar creación/cambio/borrado con servidor activo, reinicio, escrituras fallidas y concurrencia. Revalidar identidad al completar un login concurrente con revocación.
- Mantener mínimos roles explícitos por ruta y denegación por defecto; ocultar botones en UI no autoriza operaciones.
- Acotar intentos globales/por origen, concurrencia PBKDF2 y tamaño de mapas; el límite actual por IP+usuario no basta ante muchos nombres diferentes. Sólo confiar en cabeceras de proxy si su emisor está configurado como confiable.
- El audit actual escribe después de la acción y sólo informa errores en logs. Definir política para fallos, rotación, retención, redacción y protección frente a modificación. No afirmar que sea un registro inmutable.
- El comando de terminal se registra parcialmente en claro: puede contener secretos. Diseñar política sin almacenar tokens/contraseñas y sin perder atribución del acto administrativo.

## Validación

Mantener `auth_test.go` y ampliar los escenarios anteriores antes de mover persistencia. CLI y servicio deben usar el mismo directorio y usuario de servicio. Detener binarios anteriores al actualizar; véase [desarrollo](../development.md). `auth_persistence_test.go` cubre CLI en proceso separado, password/borrado con servidor activo, login concurrente con cambio de password, sesiones simultáneas, almacenamiento fallido y JSON corrupto. La PTY comprueba revocación externa en `terminal_session_test.go`.
