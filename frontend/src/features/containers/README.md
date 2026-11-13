# Feature: contenedores

Entradas públicas: `index.ts` para API/tipos; `ContainersView.tsx` y `ContainerDetail.tsx` para composición lazy desde App. No exportar las pantallas por el barrel de API: una lectura de datos desde Dashboard no debe cargar sus componentes.

- `api.ts`: peticiones CoreOps, codificación de IDs y verificación del resultado de acciones. Usa `shared/api/client`, no `lib/api`.
- `mapper.ts`: DTO de lista → modelo de UI. Reinicios sin medición son `null`, mostrados como `—`; nunca un cero supuesto.
- `model.ts`: tipos de presentación independientes de Docker y del transporte.
- Pantallas: misma composición, navegación, filtros, confirmaciones, estados y reconciliación tras acciones. Mantienen su estado local; no se añade una librería global ni hooks sin consumidor reutilizable.

Los DTOs wire se importan sólo como tipos desde `api/typescript/containers.ts`. Las colecciones nulas válidas del inspect se normalizan en el adaptador para que la UI no haga `.join`/`.length` sobre null. Las mediciones desconocidas no se normalizan a cifras. CPU/memoria numéricas auxiliares heredadas siguen siendo placeholders para presentación/ordenación, no mediciones para gráficas.

`lib/api.ts` y `lib/types.ts` reexportan API/modelos como fachadas de compatibilidad para capacidades aún sin migrar; no duplican implementaciones. Los tipos genéricos de diálogo siguen llegando de la fachada legacy; su traslado a shared queda pendiente. Nuevas features no deben importar internals de contenedores, sino su entrada pública.

Validación: `pnpm check:boundaries`, `pnpm format:check`, `pnpm build`, `pnpm test:ui`. La suite cubre layout en ocho formatos, acciones/reconciliación, nulos en inspect, datos desconocidos y errores 403/401 con un único almacén de sesión. No modifica Docker real.
