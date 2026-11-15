# Plan incremental de modularización

Propuesta del 2026-11-12. En esta entrega sólo cambian documentos. [Arquitectura](architecture.md) define destino y dependencias; [módulos](modules/README.md) contiene instrucciones; [seguridad](security.md) registra evidencias y criterios de cierre.

## Secuencia

| Paso | Alcance de una entrega revisable | Validación / salida |
| --- | --- | --- |
| 0 — documentación (esta entrega) | Conciliar estado, decisiones, riesgos y guías; conservar UI y código | Enlaces/diff revisados; baseline Go y web registrado |
| 1 — identidad coherente | SEC-01: decidir mecanismo de persistencia único para CLI/servicio y revocación; cubrir fallos antes de extraer auth | Tests de cambio/borrado/password con servidor activo, reinicio y disco fallido; datos existentes migrables |
| 2 — contrato inicial | Capturar auth/health/contenedores en OpenAPI sin cambiar URLs ni comportamiento | Contraste con handlers y cliente; esquema válido, roles/errores/ausencia definidos |
| 3 — backend contenedores | Extraer casos de uso, pequeño puerto Docker, adaptador y handlers; startup compone | Pruebas HTTP 401/403/targets/errores/cancelación; go test/vet/build; smoke seguro con contenedor desechable |
| 4 — frontend contenedores | Transporte compartido y feature con adaptadores/hooks; corregir desconocidos visibles (`restarts`) | Build y pruebas de acciones/error/refresh, revisión escritorio/móvil sin rediseño |
| 5 — reducir autoridad | SEC-02/03/04 en entregas separadas: terminal, sesión web/nativa, privilegios del servicio | Criterios de cierre del registro de seguridad; no ampliar exposición antes de cubrir P0 |
| 6 — capacidades restantes | Extraer identidad/audit y después servicios/host, observabilidad, apps/VMs, seguridad/updates según uso | Un módulo por cambio; contrato, guía y pruebas propias; errores parciales reales |
| 7 — operaciones | Resolver artefactos/rutas y rollback, validación de dependencias/imports y CI de integración | Release comprobada, restauración y políticas de seguridad efectivas |

No es necesario esperar al paso 7 para corregir un riesgo urgente: priorizar los hallazgos aplicables sin mezclar una reorganización global con cambios de comportamiento. Tampoco hay obligación de crear todas las carpetas de destino en una sola entrega.

## Criterio de finalización de cada módulo

Responsabilidad y dependencias explícitas; ninguna llamada privilegiada desde navegador; contrato compatible y permiso preservado; tests de comportamiento relevante; app compilable; datos desconocidos honestos; guía e inventario actualizados; diff acotado. Añadir controles automáticos de importación cuando exista el primer patrón consolidado, no antes de saber qué frontera se está comprobando.

## Decisiones que se mantienen abiertas

Motor de persistencia para coherencia (SQLite es candidato, no cambio aprobado ni implementado); cookies web frente a otra estrategia de sesión; plugin seguro nativo; mecanismo de jobs largos; tooling OpenAPI/generación; separación futura de agente privilegiado. Resolver cada una en su entrega con coste, compatibilidad y prueba de recuperación. No introducir microservicios para resolver estructura de carpetas.
