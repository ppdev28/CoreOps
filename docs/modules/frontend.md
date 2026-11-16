# Frontend

## Responsabilidad y estado

React 19, TypeScript estricto, Vite 8, Tailwind 4; pnpm. Preservar el diseño Figma. `App.tsx` compone navegación, sesión y shell, con carga diferida de vistas. `features/containers/` ya contiene API, mapeo, modelos y pantallas propias; `shared/api` contiene transporte y `shared/platform` la única sesión existente. `views/`, `components/` y las fachadas `lib/*` permanecen para el resto. El almacenamiento sigue siendo localStorage; la extracción no cambia SEC-03.

## Instrucciones

- Contenedores ya está extraído: leer su [guía](../../frontend/src/features/containers/README.md). Migrar otras features por necesidad; exponer entradas públicas y mantener lazy las pantallas, sin crear archivos vacíos o hooks sin reutilización.
- Separar transporte compartido (`shared/api`) de peticiones y mapeos específicos. Las vistas no construyen cabeceras/token ni conocen el SDK Docker.
- Hooks de cada flujo coordinan carga, cancelación, errores, acción pendiente y reconciliación. Conservar búsqueda/filtros, confirmaciones y prevención de duplicados. No añadir librería de estado sin un problema concreto.
- Componer desde `app`; `shared` no importa features y una feature no accede a internos de otra. Mantener tokens/componentes Figma como primitivas comunes.
- Reinicios sin medición ya se representan como `null`/`—`. Mantener desconocidos explícitos. CPU/memoria conservan ceros auxiliares legacy para presentación/ordenación que no deben alimentar gráficas como mediciones.
- Diseñar sesiones por perfil de servidor: el token sólo puede enviarse al origen al que pertenece. Revisar cambios de URL y `VITE_API_BASE_URL` antes de persistir sesiones.
- Mantener errores 401/403 y estados vacío/no disponible. Comprobar permisos en UI como ayuda al usuario; la autoridad está en la API.

## Validación

`pnpm build` comprueba TypeScript y bundle; `pnpm format:check` es un control separado. Existe un runner Playwright para Dashboard (`pnpm test:dashboard`); aún faltan pruebas del resto de flujos. Incorporar pruebas de mapeo y del flujo de acciones al extraer contenedores, con casos de error/refresh/403 y valores desconocidos; verificar escritorio y móvil. La compilación no valida comportamiento visual.

## Apariencia compartida

La dirección visual monocroma y redondeada se aplica ahora a toda la aplicación con `.app-workspace`. `lib/appearance.ts` define temas/presets y contraste; `webSettings.ts` valida/persiste `accentColor`; `tokens.ts` aplica los cambios guardados al instante. No añadir paletas fijas por pantalla. Usar `T.primary` para relleno, `T.onAccent` para su texto y `T.accent` para interacción/foco; colores de estado por separado.

`styles/application.css` concentra el responsive general; los grids se identifican con `data-layout` y superficies con `data-surface`. Evitar mínimos intrínsecos que desborden una columna (`minmax(0,1fr)`); las tablas densas pueden desplazarse en su propio contenedor. Mantener accesibles los controles en horizontal y sin teclado/ratón.

El Dashboard conserva primitives shadcn y Tremor Raw con licencias; el resto reutiliza su API de componentes existente. `components/ui/` y el archivo legacy `components/ui.tsx` coexisten. Las fuentes son locales.

Ver [guía visual](../ui-style.md). `pnpm test:ui` ejecuta las pruebas Playwright de las capacidades integradas con fixtures aislados, incluidos todos los destinos y detalle en ocho formatos, persistencia y contraste. La limpieza Android ya se completó por separado; el chrome nativo tiene paleta estática y no refleja aún todos los ajustes web.

La [terminal interactiva](terminal.md) usa xterm.js 6 + Fit/Search/WebLinks. Tiene pestañas con conexiones independientes, resize real, teclado móvil y conserva sesiones al navegar. No reconstruir readline ni limpiar ANSI en React. El ACK de salida se envía en el callback de `term.write`, para respetar el control de flujo del servidor. Las pruebas específicas verifican persistencia, permisos y el ciclo de vida de la terminal.

## Creación de contenedores (2026-11-15)

`ContainersView.tsx` abre `components/CreateContainerDialog.tsx` para admin, reutilizando temas/tokens. El dialog nativo gestiona foco/Escape y bloquea cierre/submit duplicado durante la petición. El formulario conserva datos tras error, representa creación con fallo de arranque como resultado parcial, refresca inventario y permite abrir inspect. `lib/api.ts` mantiene DTOs CoreOps explícitos; no exponer opciones Docker arbitrarias. La suite tiene 26 pruebas: creación/configuración, pending, permisos, errores, arranque parcial y diseño a 320px, además de las pruebas existentes. Contrato: [backend README](../../backend/README.md#container-creation).

## Eliminación de contenedores (2026-11-15)

Delete deja de emitir un éxito simulado: llama a la API con admin, exige confirmación mediante `ConfirmDialog.requireConfirmation` y sólo retira la fila al confirmar `{ok,id}`. Mantener el bloqueo por ID durante todas las mutaciones, selección reconciliada, mensajes persistentes y rechazo de estados activos. La suite tiene 34 pruebas, ocho nuevas para cancelación/confirmación obligatoria, pending, fallos, roles y móvil. No añadir force ni eliminación de volúmenes sin una decisión de producto explícita.

## Explorador de logs (2026-11-15)

Vista inspirada en Dozzle, con panel de contenedores, pestañas/comparación, filtros, JSON, exportación y modo foco. Mantener el estilo aislado, roles operator/admin y snapshots de datos reales. Contrato, límites y validación en [Logs](logs.md). La suite tiene 42 pruebas; la carga diferida de Logs no debe interrumpir PTY.

## Terminal responsive (2026-11-15)

Terminal tiene herramientas compactas para móvil, controles táctiles, teclado explícito, modo foco y ajuste de PTY por viewport real sin reconexión. `App.tsx` sólo elimina el gutter reservado del main cuando Terminal está visible. Los estilos y popover usan tokens CoreOps y el componente accesible existente. Ver [comportamiento y pruebas](terminal.md#ajuste-responsive--2026-11-15); suite de interfaz: 57 pruebas. No usar autofocus táctil ni capturar Escape del input de la shell para salir del modo foco.

## Modal Compose (2026-11-15)

CreateContainerDialog conserva ambos drafts con pestañas accesibles; CreateComposeForm valida YAML/carga UTF-8 y exige preview vigente antes de crear un proyecto nuevo. Pending bloquea cambios de método/cierre; los resultados parciales impiden recreación desde ese formulario y permiten inspección real. Estado no persistido en localStorage; no mostrar secretos del entorno en preview/audit. Backend admin es autoridad. [Guía](compose.md), siete pruebas nuevas; suite web: 64.

`pnpm check:boundaries` y CI verifican que shared no importe features/views/lib, las features no vuelvan al cliente legacy y los tipos de contrato no contengan ejecución. Sólo cubre las fronteras migradas, no certifica toda la aplicación legacy.

Integración 2026-11-16: Containers/Inspect cargan desde `features/containers`; create/delete y cancelación se conservan. Files y Terminal viven fuera del Suspense de rutas para que la primera carga de una pantalla no cierre PTYs ni pierda el directorio/transferencias. La sesión compartida tiene una sola caché/listeners, consumida también por los módulos legacy.
