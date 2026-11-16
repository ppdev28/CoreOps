# Explorador de archivos

Admin exclusivo, configuración `COREOPS_FILES_ROOT` y permisos de la cuenta del
servicio. Backend en `files*.go`, cliente `lib/files.ts`, vista persistente
`FileExplorerView.tsx`; [contrato original](../../backend/README.md#file-explorer).
Las transferencias/directorio siguen montados al navegar y no suspenden Terminal.

## Eliminación de archivos

`DELETE /api/v1/files` recibe JSON `{path,version}`. Cada fichero regular en el
listado incluye un identificador opaco de inode/tamaño/mtime/modo. Se comprueba de
nuevo antes de borrar: si cambió devuelve 409 y exige refrescar/revisar. Se abre
el directorio padre por descriptor dentro de `os.Root` y se desvincula sólo esa
entrada con `unlinkat(flags=0)`, que nunca hace rmdir aunque la entrada se
sustituya concurrentemente por un directorio vacío. No se siguen symlinks finales,
no hay borrado recursivo ni comandos shell.
Directorios, dispositivos, symlinks y raíz se rechazan. La operación está limitada
por los permisos reales del servicio; nunca llama a sudo ni elude un filesystem
read-only. Los archivos activos de identidad, lock y auditoría CoreOps se protegen
también al acceder por hard links.

La UI muestra botón Delete por archivo regular, exige confirmación siempre con
raíz/ruta/consecuencia permanente, bloquea duplicados y sólo elimina la fila tras
un resultado correcto. No hay papelera ni deshacer. Los fallos se mantienen visibles
sin depender de notificaciones. Preserva uploads/downloads y filtros/directorio.

401 anónimo; 403 rol/permiso/archivo CoreOps protegido; 400 input o tipo no admitido;
404 ausente; 409 versión cambiada; 200 `{ok:true,path}` tras unlink. Auditoría de la
ruta lógica y resultado. No se guarda contenido de archivos en audit. Como cualquier
unlink por nombre, un escritor externo puede sustituir una entrada entre la última
inspección y unlink: la comparación de versión no es una transacción con procesos
ajenos. Los descriptores mantienen la resolución confinada; no prometer atomicidad
frente a todos los cambios externos o borrado seguro de datos del dispositivo.

Validar con archivos desechables: autenticación, rutas, symlinks/traversal,
precondiciones, permisos, protección de identidad y resultado real. UI: confirmación
incluso con confirmaciones opcionales desactivadas, fallo/pending/éxito y móvil.
Nunca borrar archivos reales del sistema para probar la capacidad.
