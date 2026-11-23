# Network y puertos en escucha

`network.go` consulta interfaces Linux y `ss -lntup` desde Go. El navegador sólo
consume GET `/api/v1/network` (viewer). `ListeningPorts.tsx` conserva cada binding
IPv4/IPv6 en una tabla con cabecera fija, grupos plegables por protocolo, origen,
contenedor o proceso, y vista sin agrupación. No deduplica puertos por número.

Filtros combinables: búsqueda de varias palabras, protocolo, origen, dirección de
bind, estado de socket y números/rangos (por ejemplo `80,443,8000-8100`). Orden por
puerto o proceso; contador de bindings y números de puerto distintos; limpiar
filtros y expandir/colapsar grupos. Los controles son accesibles y la tabla puede
desplazarse en su propio contenedor en móvil. No se cambian firewall ni sockets.

Desde 2026-11-22, la asociación con Docker compara protocolo, puerto **y dirección
de publicación**, con contenedores activos. TCP/UDP o IP distintas no comparten
automáticamente propietario. Un wildcard ambiguo y un fallo de lectura Docker se
representan como atribución desconocida. `Host / unmapped` sólo significa que no
hay coincidencia con publicaciones Docker observadas; no demuestra aislamiento
del proceso. Se corrigió además el parser que eliminaba la primera letra del
nombre del proceso de `ss`.

`Loopback`, `All interfaces` y `Specific address` describen el bind, no exposición
externa. Firewall, NAT, namespaces, capacidades del servicio y permisos para ver
procesos limitan la evidencia. No presentar un binding wildcard como puerto
accesible desde Internet, ni un proceso oculto como inexistente. Los filtros se
aplican al snapshot recibido, no a un inventario exhaustivo de toda la red.

Tests: `network_ports_test.go` cubre protocolos/IP coincidentes, proceso completo,
IPv6, wildcard ambiguo y Docker no disponible. `usability.spec.ts` prueba filtros,
rangos inválidos, orden, grupos y 320/1440 px. Validación real sólo de lectura con
API aislada y comparación con `ss`/inventario Docker; nunca cambiar puertos de
servicios del usuario para probar una tabla.

## Filtros de escritorio — 2026-11-22

Desde 1024 px, los controles se organizan en dos filas de cuatro columnas, con
búsqueda de doble anchura, panel delimitado, agrupación junto al título, etiquetas
más legibles y foco de teclado visible. Cambio exclusivo de CSS en ese breakpoint;
se conservan filtros, orden, agrupación, API y vistas inferiores a 1024 px.
Capturas de controles a 320/390/768 px idénticas antes/después; revisión a
1024/1440/1920 px, suite focalizada Network/Security y API real de sólo lectura.
Ver [informe](../network-desktop-security-review-2026-11-22.md).
