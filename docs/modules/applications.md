# Applications y detalle de sus contenedores

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
