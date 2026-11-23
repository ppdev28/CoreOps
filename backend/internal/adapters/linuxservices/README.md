# linuxservices

Adaptador Go de los comandos exactos `sudo -n -- HELPER check|apply`.
`helperpath` selecciona `/usr/local/libexec` para fuente y `/usr/libexec/coreops`
en paquete. Verifica propietario root, ejecutable, padres no escribibles ni
symlinks; no usa shell ni systemctl privilegiado directamente.

JSON acotado por stdin, protocolo y salida verificados, timeout 9 s y sin
reintentos. Un resultado de apply no verificable es incierto. ValidUnit,
ValidAction y Protected comparten la política con el consumidor; el helper root
revalida de forma independiente y comprueba identidad canónica/archivos de unit.
El consumidor conserva autorización/audit y serialización; el adaptador no conoce
HTTP ni credenciales de CoreOps. [Contrato y operación](../../../../docs/modules/services.md).
