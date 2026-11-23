# Applications y detalle de sus contenedores

## Filtros e iconos — 2026-11-22

Applications combina búsqueda por palabras (incluye imagen/nombre/puertos/red de
miembros por ID), categoría con contadores, estado y número de miembros; orden por
nombre, estado o cantidad. Clear filters restaura los valores iniciales. Sólo se
muestran categorías presentes, incluidas las personalizadas; un filtro activo que
se queda sin resultados sigue visible con contador cero. Fallar `/containers`
no oculta `/applications`: avisa de que la búsqueda sólo cubre campos de apps.
Refresh cancela lecturas anteriores y reconcilia ambos inventarios; la pertenencia
sigue procediendo exclusivamente de IDs explícitos, nunca de nombres parecidos.

`ApplicationIcon.tsx` se reutiliza en lista, detalle y miembros. Los logos comunes
se distribuyen como assets locales, también en el bundle de Capacitor; Simple
Icons conocido se resuelve localmente, sin depender del CDN. Logos inferidos sólo
afectan presentación, nunca pertenencia/estado/categoría. Una URL personalizada
válida conserva prioridad y no envía referrer; al fallar usa un logo local conocido
o Lucide por categoría. La URL no se muestra como texto y cambiar la fuente puede
recuperar un icono fallido. El fondo claro de los assets conserva logos oscuros
legibles. No hay proxy de imágenes ni solicitudes de URLs desde el backend.

40 imágenes SVG/PNG seleccionadas de
[dashboard-icons](https://github.com/homarr-labs/dashboard-icons), revisión fijada
en `frontend/src/assets/application-icons/NOTICE`; licencia Apache-2.0 incluida.
Las copias de LICENSE/NOTICE en `frontend/public/licenses/dashboard-icons` se
incluyen también en dist/APK. Los nombres/logos siguen perteneciendo a sus titulares. Nuevos logos requieren
revisar origen/licencia y SVG sin script, foreignObject o recursos externos.
Las apps desconocidas conservan una reserva genérica; no se promete logo de todas
las imágenes Docker. Validación en `usability.spec.ts` y el inspector existente.

`backend/cmd/coreops-api/applications.go` agrupa el inventario real por
`com.docker.compose.project`; los contenedores independientes aparecen como apps
de un miembro. `/applications` publica los IDs explícitos. No se infiere pertenencia
por prefijos/nombres ni se crea un segundo modelo Docker en el navegador.

Desde 2026-11-17 `ApplicationsView.tsx` muestra miembros mediante
`components/ApplicationContainers.tsx`, cruzando esos IDs con `/containers`.
Nombre, imagen, estado, redes, puertos, ID y creación proceden del inventario;
miembros ausentes, relaciones no disponibles y errores de lectura quedan explícitos.
Refresh application reconcilia app y miembros; las acciones usan el estado observado
tras la respuesta, sin asumir running/stopped por el verbo solicitado. Stop/restart
pasan por la confirmación compartida. Se conservan errores y datos obsoletos visibles.

App compone el inspector existente `features/containers/ContainerDetail.tsx` con
un callback de render, etiqueta contextual de vuelta y las mismas acciones/tabs de
Containers. Volver desde inspect conserva la app seleccionada; Logs/Terminal usan
sus workspaces existentes. No importar pantallas privadas entre features ni duplicar
las consultas inspect, interfaces SDK o permisos. CSS propio responsive en
`styles/applications.css`; no rediseño de navegación global.

Viewer puede consultar el inventario/resumen. Inspect/configuración y acciones de
aplicación siguen siendo operator/admin en backend; Terminal admin. La UI oculta
los controles correspondientes a viewer. No endpoints nuevos ni permisos elevados.

Validar con aplicaciones reales/IDs actuales y fixtures de varios miembros,
aislamiento de pertenencia, ausentes/errores/refresh, retorno al detalle de app,
roles, estado real después de acciones y escritorio/móvil. No detener apps reales
para probar su detalle. Las acciones Compose de creación son otro flujo:
[Compose](compose.md).
