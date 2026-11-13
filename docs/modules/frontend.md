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

Ver [guía visual](../ui-style.md). `pnpm test:ui` ejecuta 23 pruebas Playwright con fixtures aislados, incluidos todos los destinos y detalle en ocho formatos, persistencia y contraste. La limpieza Android ya se completó por separado; el chrome nativo tiene paleta estática y no refleja aún todos los ajustes web.

La [terminal interactiva](terminal.md) usa xterm.js 6 + Fit/Search/WebLinks. Tiene pestañas con conexiones independientes, resize real, teclado móvil y conserva sesiones al navegar. No reconstruir readline ni limpiar ANSI en React. El ACK de salida se envía en el callback de `term.write`, para respetar el control de flujo del servidor. La suite tiene ahora 23 pruebas, incluidas cinco específicas de terminal.

`pnpm check:boundaries` y CI verifican que shared no importe features/views/lib, las features no vuelvan al cliente legacy y los tipos de contrato no contengan ejecución. Sólo cubre las fronteras migradas, no certifica toda la aplicación legacy.
