# Frontend

## Responsabilidad y estado

React 19, TypeScript estricto, Vite 8, Tailwind 4; pnpm. Preservar el diseño Figma. `App.tsx` compone navegación, sesión y shell, con carga diferida de vistas. `views/` contiene pantallas, `components/` los elementos visuales y `lib/api.ts` mezcla peticiones, tipos y adaptación. `lib/auth.ts` guarda sesión y servidor en localStorage.

## Instrucciones

- Migrar primero contenedores a `features/containers/{api,model,hooks,components}` según necesidad; exponer entradas desde el módulo, sin trasladar cada función a un archivo.
- Separar transporte compartido (`shared/api`) de peticiones y mapeos específicos. Las vistas no construyen cabeceras/token ni conocen el SDK Docker.
- Hooks de cada flujo coordinan carga, cancelación, errores, acción pendiente y reconciliación. Conservar búsqueda/filtros, confirmaciones y prevención de duplicados. No añadir librería de estado sin un problema concreto.
- Componer desde `app`; `shared` no importa features y una feature no accede a internos de otra. Mantener tokens/componentes Figma como primitivas comunes.
- Modelar métricas desconocidas con `null` o estado explícito: hoy `toContainer` asigna `restarts: 0`, visible como cero en tarjetas/tabla pese a no venir del endpoint. Corregirlo en una entrega independiente; CPU/memoria también tienen ceros auxiliares que no deben alimentar gráficas como mediciones.
- Diseñar sesiones por perfil de servidor: el token sólo puede enviarse al origen al que pertenece. Revisar cambios de URL y `VITE_API_BASE_URL` antes de persistir sesiones.
- Mantener errores 401/403 y estados vacío/no disponible. Comprobar permisos en UI como ayuda al usuario; la autoridad está en la API.

## Validación

`pnpm build` comprueba TypeScript y bundle; `pnpm format:check` es un control separado. Existe un runner Playwright para Dashboard (`pnpm test:dashboard`); aún faltan pruebas del resto de flujos. Incorporar pruebas de mapeo y del flujo de acciones al extraer contenedores, con casos de error/refresh/403 y valores desconocidos; verificar escritorio y móvil. La compilación no valida comportamiento visual.

## Apariencia compartida

La dirección visual monocroma y redondeada se aplica ahora a toda la aplicación con `.app-workspace`. `lib/appearance.ts` define temas/presets y contraste; `webSettings.ts` valida/persiste `accentColor`; `tokens.ts` aplica los cambios guardados al instante. No añadir paletas fijas por pantalla. Usar `T.primary` para relleno, `T.onAccent` para su texto y `T.accent` para interacción/foco; colores de estado por separado.

`styles/application.css` concentra el responsive general; los grids se identifican con `data-layout` y superficies con `data-surface`. Evitar mínimos intrínsecos que desborden una columna (`minmax(0,1fr)`); las tablas densas pueden desplazarse en su propio contenedor. Mantener accesibles los controles en horizontal y sin teclado/ratón.

El Dashboard conserva primitives shadcn y Tremor Raw con licencias; el resto reutiliza su API de componentes existente. `components/ui/` y el archivo legacy `components/ui.tsx` coexisten. Las fuentes son locales.

Ver [guía visual](../ui-style.md). `pnpm test:ui` ejecuta 20 pruebas Playwright con fixtures aislados, incluidos todos los destinos y detalle en ocho formatos, persistencia y contraste. Los recursos nativos sin seguimiento siguen intactos; el chrome nativo tiene paleta estática y no refleja aún todos los ajustes web.

La [terminal interactiva](terminal.md) usa xterm.js 6 + Fit/Search/WebLinks. Tiene pestañas con conexiones independientes, resize real, teclado móvil y conserva sesiones al navegar. No reconstruir readline ni limpiar ANSI en React. El ACK de salida se envía en el callback de `term.write`, para respetar el control de flujo del servidor. La suite tiene ahora 20 pruebas, incluidas cinco específicas de terminal.
