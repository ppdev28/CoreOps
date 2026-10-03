# CoreOps — React guide for beginners

Este documento es una guía práctica para entender **CoreOps (CoreOps)** si todavía tienes poca experiencia con React. La idea no es enseñarte React desde cero como un curso completo, sino explicarte **cómo está organizado este proyecto, dónde tocar cada cosa y qué ocurre cuando modificas una pantalla**.

---

## 1. La idea general de CoreOps

CoreOps tiene dos partes principales:

```text
CoreOps/
├── frontend/        ← React + TypeScript + Vite
└── backend/         ← Go + Docker API + Linux/systemd
```

El navegador ejecuta el `frontend`.

El `backend` se ejecuta en el servidor y es el que puede hablar con Docker, systemd, UFW, SSH, discos, red, etc.

El flujo normal es:

```text
Usuario
   ↓
React (frontend)
   ↓ HTTP /api/v1/...
Go (backend)
   ↓
Docker / Linux / systemd / UFW / etc.
```

Por ejemplo, cuando abres **Applications**:

1. `ApplicationsView.tsx` pide los datos.
2. `lib/api.ts` hace `GET /api/v1/applications`.
3. Go recibe la petición.
4. `applications.go` consulta Docker.
5. Go devuelve JSON.
6. React guarda el resultado en un estado (`useState`).
7. React vuelve a renderizar la pantalla con los datos reales.

---

# 2. Estructura del frontend

La parte que más te interesa al desarrollar UI está aquí:

```text
frontend/
├── package.json
├── vite.config.*
├── tsconfig.*
└── src/
    ├── App.tsx
    ├── main.tsx
    ├── components/
    ├── lib/
    ├── styles/
    └── views/
```

## `src/App.tsx`

Es uno de los archivos más importantes.

Actúa como el punto central de la aplicación React. Entre otras cosas, conecta las vistas con la navegación y gestiona elementos globales como los toasts y algunas preferencias.

Si quieres saber **qué pantalla se muestra cuando pulsas una opción del sidebar**, empieza mirando `App.tsx`.

---

## `src/main.tsx`

Es el punto de entrada de React.

Conceptualmente hace algo parecido a:

```tsx
createRoot(document.getElementById('root')!).render(
  <App />
)
```

Es decir:

```text
main.tsx → App.tsx → resto de componentes
```

Normalmente no necesitarás modificarlo para trabajar en una pantalla concreta.

---

# 3. `components/`: piezas reutilizables

Aquí están los componentes que se utilizan en varias pantallas.

Por ejemplo:

```text
components/
├── shell.tsx
└── ui.tsx
```

### `shell.tsx`

Contiene la estructura general de CoreOps: sidebar, navegación, cabecera y zona principal.

Si quieres cambiar cosas globales de la aplicación, como el sidebar, este es uno de los primeros archivos que debes revisar.

### `ui.tsx`

Contiene componentes reutilizables como botones, cards, inputs, badges, estados de carga, etc.

Por ejemplo, en lugar de crear un botón desde cero en cada vista:

```tsx
<Btn variant="primary">Start</Btn>
```

Esto mantiene el diseño consistente.

**Regla práctica:** si necesitas cambiar el aspecto de todos los botones de CoreOps, probablemente debes tocar `components/ui.tsx`, no veinte vistas diferentes.

---

# 4. `views/`: las pantallas

Esta es probablemente la carpeta que más vas a utilizar.

```text
views/
├── ApplicationsView.tsx
├── ContainersView.tsx
├── HostView.tsx
├── LogsView.tsx
├── MonitoringView.tsx
├── NetworkView.tsx
├── SecurityView.tsx
├── ServicesView.tsx
├── SettingsView.tsx
├── StorageView.tsx
├── TerminalView.tsx
└── UpdatesView.tsx
```

Cada archivo representa una pantalla o sección de CoreOps.

Por ejemplo:

```text
ApplicationsView.tsx → Applications
SecurityView.tsx     → Security
TerminalView.tsx     → Terminal
SettingsView.tsx     → Settings
```

Si quieres cambiar **qué aparece dentro de una pantalla**, normalmente empiezas por su `View`.

---

# 5. `lib/`: lógica compartida

Aquí hay varias piezas importantes.

## `lib/api.ts`

Es el puente entre React y el backend.

Ejemplo simplificado:

```tsx
export async function getApplications() {
  return request('/applications')
}
```

Y desde una vista:

```tsx
const apps = await getApplications()
```

No necesitas poner URLs del backend por todas partes. Centralizamos las llamadas en `api.ts`.

Si quieres añadir una nueva llamada al backend, normalmente:

1. Añades el endpoint en Go.
2. Añades la función correspondiente en `lib/api.ts`.
3. La utilizas desde la `View`.

---

## `lib/types.ts`

Contiene los tipos TypeScript que describen los datos.

Ejemplo:

```tsx
export interface AppService {
  id: string
  name: string
  description: string
  status: ContainerStatus
  containers: number
  version: string
  category: string
  icon: string
}
```

Esto permite que TypeScript te avise si intentas hacer algo incorrecto.

---

## `lib/tokens.ts`

**Este archivo es especialmente importante para cambiar el aspecto visual de CoreOps.**

Aquí están los colores y tokens visuales usados por las vistas.

Por ejemplo:

```tsx
T.text
T.textDim
T.bg
T.raised
T.border
T.accent
T.green
T.red
```

En una vista puedes encontrar algo como:

```tsx
style={{ color: T.text }}
```

Eso significa que el componente utiliza el color definido por el token `text`.

### ¿Quieres cambiar el color principal de CoreOps?

Empieza por `lib/tokens.ts`.

### ¿Quieres cambiar el color del texto principal?

Busca `T.text` en `lib/tokens.ts`.

### ¿Quieres cambiar el color de éxito?

Busca `T.green`.

### ¿Quieres cambiar el color de errores?

Busca `T.red`.

**Importante:** no es recomendable cambiar cientos de componentes individualmente. Primero busca si el color que quieres cambiar ya existe como token.

---

## `lib/webSettings.ts`

Contiene las preferencias de la interfaz web: tema, compactación, movimiento, auto-refresh, notificaciones, sonido, shortcuts, confirmaciones destructivas, etc.

Es el sitio que debes revisar si quieres entender cómo se guardan las preferencias de Settings.

---

# 6. `styles/`

Aquí están estilos globales específicos que no encajan bien como estilos inline de un componente.

Por ejemplo:

```text
styles/sidebar.css
```

Si algo afecta a una parte visual global y no tiene sentido repetirlo dentro de una vista, puede ser candidato para esta carpeta.

---

# 7. ¿Qué es React?

React no es un lenguaje de programación. Es una **biblioteca de JavaScript/TypeScript para construir interfaces de usuario mediante componentes**.

Una pantalla de React se construye combinando componentes.

Por ejemplo:

```tsx
function Saludo() {
  return <h1>Hola</h1>
}
```

Ese componente produce:

```html
<h1>Hola</h1>
```

Pero en React normalmente compones piezas más grandes:

```tsx
function App() {
  return (
    <main>
      <Header />
      <ApplicationsView />
    </main>
  )
}
```

Piensa en React como un árbol:

```text
App
├── Shell
│   ├── Sidebar
│   └── Content
│       └── ApplicationsView
│           ├── Search
│           ├── Filters
│           └── ApplicationCard
```

---

# 8. JSX: HTML dentro de JavaScript/TypeScript

En React escribirás cosas como:

```tsx
<div>
  <h1>Applications</h1>
  <p>Installed applications</p>
</div>
```

Esto se llama **JSX**.

No es HTML puro. Es sintaxis que React transforma en elementos de la interfaz.

Puedes utilizar JavaScript dentro de JSX:

```tsx
<h1>{app.name}</h1>
```

Si `app.name` vale `Grafana`, React mostrará:

```text
Grafana
```

---

# 9. `useState`: guardar información que cambia

Uno de los conceptos fundamentales de React es el estado.

Ejemplo:

```tsx
const [search, setSearch] = useState('')
```

Hay dos partes:

```text
search     → valor actual
setSearch  → función para cambiarlo
```

Si haces:

```tsx
setSearch('grafana')
```

React vuelve a renderizar el componente usando el nuevo valor.

Esto es exactamente lo que ocurre con los filtros de Applications.

---

# 10. `useEffect`: ejecutar algo cuando cambia algo

Ejemplo:

```tsx
useEffect(() => {
  void load()
}, [load])
```

Puedes interpretarlo como:

> "Cuando el componente se monte o cambie esta dependencia, ejecuta esta función."

Se utiliza mucho para:

- cargar datos del backend;
- iniciar polling;
- escuchar eventos;
- registrar listeners;
- limpiar recursos.

---

# 11. `useMemo`: calcular datos derivados

Ejemplo típico en Applications:

```tsx
const filtered = useMemo(() => {
  return apps.filter(...)
}, [apps, cat, query])
```

`filtered` no es el dato original.

Es un dato calculado a partir de:

```text
apps + categoría + búsqueda
        ↓
     filtered
```

Cuando cambia cualquiera de esas cosas, React recalcula el resultado.

---

# 12. `useCallback`: mantener funciones estables

Puedes encontrar:

```tsx
const load = useCallback(async () => {
  ...
}, [])
```

No necesitas dominar `useCallback` para empezar a modificar CoreOps.

En este proyecto se utiliza principalmente para evitar recrear ciertas funciones que se utilizan como dependencias de `useEffect`.

---

# 13. Props: pasar información a componentes

Un componente puede recibir información:

```tsx
<Card title="Applications" />
```

`title` es una **prop**.

Otro ejemplo:

```tsx
<Btn variant="primary">Start</Btn>
```

El componente `Btn` recibe `variant` y el contenido `Start`.

Piensa en las props como parámetros de una función.

---

# 14. Eventos

React escucha eventos del navegador:

```tsx
onClick={() => setSearch('')}
```

Significa:

> Cuando el usuario haga click, ejecuta esta función.

Para inputs:

```tsx
onChange={value => setSearch(value)}
```

Esto hace que el estado `search` siga lo que escribe el usuario.

---

# 15. Renderizado condicional

React permite decidir qué mostrar.

```tsx
{loading && <Skeleton />}
```

Significa:

> Si `loading` es verdadero, muestra `Skeleton`.

Otro ejemplo:

```tsx
{error && <ErrorState />}
```

También puedes utilizar ternarios:

```tsx
{running ? <Btn>Stop</Btn> : <Btn>Start</Btn>}
```

---

# 16. Cómo cambiar los colores de CoreOps

La forma recomendada es utilizar los tokens de `lib/tokens.ts`.

Por ejemplo, si encuentras:

```tsx
color: T.text
```

no cambies esa línea por un color hexadecimal directamente salvo que exista una razón concreta.

En su lugar, cambia el token.

Conceptualmente:

```text
T.text
  ↓
color utilizado por muchas vistas
```

Esto permite mantener un sistema visual coherente.

## Cambiar el accent

Busca el token:

```text
T.accent
```

Es el color utilizado para elementos destacados como selección, tabs y acciones principales.

## Cambiar el fondo

Busca:

```text
T.bg
```

## Cambiar el fondo elevado

Busca:

```text
T.raised
```

## Cambiar bordes

Busca:

```text
T.border
T.borderMuted
T.borderStrong
```

## Cambiar estados

```text
T.green  → éxito / activo
T.yellow → advertencia
T.red    → error / peligro
```

---

# 17. Cómo cambiar una pantalla

Supongamos que quieres cambiar Applications.

Empieza aquí:

```text
frontend/src/views/ApplicationsView.tsx
```

Si necesitas datos nuevos:

```text
frontend/src/lib/api.ts
frontend/src/lib/types.ts
```

Si esos datos todavía no existen en el backend:

```text
backend/cmd/scp-api/main.go
backend/cmd/scp-api/applications.go
```

El flujo completo sería:

```text
ApplicationsView.tsx
        ↓
lib/api.ts
        ↓
GET /api/v1/applications
        ↓
main.go
        ↓
applications.go
        ↓
Docker
```

---

# 18. Cómo investigar un bug

Cuando algo no funciona, evita cambiar código al azar.

Hazte estas preguntas:

### 1. ¿El problema es visual?

Mira primero:

```text
views/
components/
lib/tokens.ts
styles/
```

### 2. ¿El dato aparece pero es incorrecto?

Mira:

```text
lib/api.ts
lib/types.ts
```

y después el backend correspondiente.

### 3. ¿La API devuelve mal el dato?

Mira:

```text
backend/cmd/scp-api/
```

### 4. ¿La acción funciona pero la pantalla no se actualiza?

Revisa:

```text
useState
useEffect
load()
```

### 5. ¿El filtro funciona mal?

Busca dónde se calcula:

```tsx
const filtered = ...
```

y comprueba qué datos entran en ese cálculo.

---

# 19. Vite y el servidor de desarrollo

CoreOps utiliza Vite.

En `frontend/package.json` encontrarás:

```text
pnpm dev
```

Vite levanta el servidor de desarrollo y permite que React se actualice rápidamente mientras trabajas.

Para una compilación de producción:

```text
pnpm build
```

El script de build ejecuta TypeScript y después Vite.

---

# 20. TypeScript: por qué aparecen tipos por todas partes

Los archivos `.tsx` de CoreOps utilizan TypeScript.

Por eso encontrarás cosas como:

```tsx
const [apps, setApps] = useState<AppService[]>([])
```

Esto significa:

> `apps` es un array de objetos `AppService`.

Y:

```tsx
function actionApp(app: AppService, verb: ApplicationAction)
```

significa que la función espera:

- un `AppService`;
- una acción válida (`start`, `stop` o `restart`).

Al principio puede parecer más complicado que JavaScript, pero ayuda mucho a detectar errores antes de ejecutar la aplicación.

---

# 21. Regla práctica para trabajar en CoreOps

Cuando quieras implementar algo nuevo, intenta seguir este orden:

```text
1. Identificar la View
        ↓
2. Identificar los datos necesarios
        ↓
3. Comprobar lib/types.ts
        ↓
4. Comprobar lib/api.ts
        ↓
5. Si falta el endpoint → backend
        ↓
6. Implementar la UI
        ↓
7. Probar en el servidor real
```

Y antes de modificar algo global, busca si ya existe un componente o token reutilizable.

---

# 22. Chuleta rápida

| Quiero cambiar... | Mira primero... |
|---|---|
| Una pantalla | `frontend/src/views/` |
| Sidebar / navegación | `frontend/src/components/shell.tsx` |
| Botones / Cards / Inputs | `frontend/src/components/ui.tsx` |
| Colores | `frontend/src/lib/tokens.ts` |
| Settings | `frontend/src/lib/webSettings.ts` + `SettingsView.tsx` |
| Llamadas HTTP | `frontend/src/lib/api.ts` |
| Tipos de datos | `frontend/src/lib/types.ts` |
| Estilos globales concretos | `frontend/src/styles/` |
| Endpoint del backend | `backend/cmd/scp-api/main.go` |
| Lógica de Applications | `backend/cmd/scp-api/applications.go` |
| Lógica de Security | `backend/cmd/scp-api/security.go` |
| Lógica de Terminal | `backend/cmd/scp-api/terminal.go` |
| Docker | `backend/cmd/scp-api/` |

---

## Lo más importante para empezar

No necesitas entender todo React antes de tocar CoreOps.

Empieza aprendiendo estos conceptos en este orden:

```text
1. JSX
2. Componentes
3. Props
4. useState
5. Eventos (onClick / onChange)
6. Renderizado condicional
7. useEffect
8. Llamadas async / API
9. useMemo
10. useCallback
```

Con esos conceptos ya puedes entender y modificar una gran parte del frontend actual de CoreOps.
