# Identidad y auditoría

## Estado y responsabilidad

`auth.go` implementa usuarios, roles, contraseñas PBKDF2-SHA256 (600 000 iteraciones), sesiones opacas aleatorias con hash SHA-256 en servidor y TTL de 12 h por defecto. `routes.go` impone viewer/operator/admin. `users_cli.go` gestiona usuarios fuera del HTTP. `audit.go` registra mutaciones, intentos de login y rechazos; GET no se registra.

Persistencia JSON en `COREOPS_DATA_DIR`, con permisos de creación 0700/0600 y escrituras mediante temporal + rename. Esto no proporciona coherencia entre procesos ni transacciones entre archivos. El servidor mantiene usuarios/sesiones en memoria. La CLI ejecutada mientras el servidor está activo no actualiza esa memoria; los cambios pueden sobrescribirse y las revocaciones pueden no aplicarse hasta reiniciar. El logout ignora errores al persistir. No presentar esas garantías como resueltas.

## Instrucciones

- Prioridad inicial: definir un único mecanismo coherente de escritura/lectura y revocación entre CLI/servidor; valorar SQLite según necesidad transaccional real. Un mutex de proceso no resuelve accesos desde la CLI.
- Preservar formatos o diseñar migración y recuperación; nunca perder usuarios o aceptar sesiones revocadas por fallo de disco.
- Probar creación/cambio/borrado con servidor activo, reinicio, escrituras fallidas y concurrencia. Revalidar identidad al completar un login concurrente con revocación.
- Mantener mínimos roles explícitos por ruta y denegación por defecto; ocultar botones en UI no autoriza operaciones.
- Acotar intentos globales/por origen, concurrencia PBKDF2 y tamaño de mapas; el límite actual por IP+usuario no basta ante muchos nombres diferentes. Sólo confiar en cabeceras de proxy si su emisor está configurado como confiable.
- El audit actual escribe después de la acción y sólo informa errores en logs. Definir política para fallos, rotación, retención, redacción y protección frente a modificación. No afirmar que sea un registro inmutable.
- El comando de terminal se registra parcialmente en claro: puede contener secretos. Diseñar política sin almacenar tokens/contraseñas y sin perder atribución del acto administrativo.

## Validación

Mantener `auth_test.go` y ampliar los escenarios anteriores antes de mover persistencia. CLI y servicio deben usar el mismo directorio y usuario de servicio. Hasta corregir coherencia, detener el servidor para gestionar usuarios y reiniciarlo después; véase [desarrollo](../development.md).
