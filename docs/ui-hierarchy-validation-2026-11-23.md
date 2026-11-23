# Jerarquía visual y legibilidad — 2026-11-23

## Alcance

En develop, preservando toda la entrega previa pendiente de commit. El usuario
consideraba demasiado plano el diseño, especialmente Dashboard e inspect. Se
mantiene la fuente local existente, reforzando su escala/peso y usando mono sólo
para información técnica. Cabeceras semánticas, tono/divisor de tarjeta, sombra
discreta, identidad de contenedor separada, pestañas subrayadas y datos legibles.
Las preferencias de tema/acento, roles, callbacks y datos no cambian.

## Comprobaciones

- Formato, fronteras y build TypeScript/Vite correctos.
- 25 pruebas UI relevantes correctas: dashboard.spec, application.spec,
  containers.spec, container-terminal.spec y applications-detail.spec. Incluyen
  ocho formatos 320×740 a 2560×1440, navegación de todas las vistas, temas/presets/
  persistencia, roles, inspect, ordenación, estados conocidos/desconocidos y
  apertura/persistencia de terminal. No se añadieron tests que dupliquen CSS.
- Revisión antes/después de Dashboard, Overview y Network de inspect en dark,
  gray y light, escritorio 1440 y móvil 320/390: 15 vistas por fase, sin errores JS
  ni overflow de pantalla. Capturas en `/tmp/coreops-hierarchy-review/` con prefijos
  before/after; métricas de estilo en before-metrics.json y after-metrics.json.
- Valores computados desktop: Dashboard 34px/700, inspect 32px/700, títulos de
  tarjeta 15–16px/650, métricas 40,32px/650 a 1440 y valores técnicos 12px/500.
  Los títulos antiguos de tarjeta eran 12–13px y se confundían con etiquetas.
- Nombres/imágenes largos, ID de 64 caracteres, labels/env/comandos y mounts de
  fixture en las cinco pestañas a 320/390/768/1024/1280/1920: 30 combinaciones sin
  overflow de tarjeta/página ni errores JS. Inspect/code mantienen scroll interno.
  La selección expone aria-pressed. Capturas long-detail-WIDTH.png en la misma ruta.
- Hover de filas utiliza el tema; ya no introduce fondo negro fijo en Light.
  Paletas/acento se conservan; no se añaden fuentes, dependencias o servicios web.
- Paquete amd64 0.1.0~dev20261123 construido e inspeccionado con verify-deb.py:
  binario/web/owners/permisos/scripts correctos. Extraído en entorno temporal y
  ejecutado con identidad propia desechable contra Docker/host reales de lectura.
  Chromium hizo login y abrió Dashboard/detalle a 320/1440px desde Go, sin Vite,
  errores JS ni POST salvo login; cinco assets verificados y users anónimo 401.
  Identidad/proceso retirados. Capturas privadas en
  `/tmp/coreops-package-web-review-jrsgdi1m/`. Logs adicionales:
  `/tmp/coreops-hierarchy-package.log`, `coreops-hierarchy-packaged-review.log`.

Logs: `/tmp/coreops-hierarchy-ui-tests.log`, `coreops-hierarchy-build.log`,
`coreops-hierarchy-before.log`, `coreops-hierarchy-after.log`,
`coreops-hierarchy-long-review.log`. Avisos NO_COLOR/FORCE_COLOR del runner; no
equivalen a fallo de UI. No se ha probado un APK ni dispositivo físico.

## Entorno y entrega

Comprobación del 23: el usuario ya tiene `coreops.service` activo, cuenta/grupo
coreops y paquete 0.1.0~dev20261122. Esa instalación no coincide con las notas
históricas que indicaban instalación pendiente. Vite 5173 sigue activo y muestra
los cambios fuente; el servicio 8082 sirve assets empaquetados de la versión vieja.
No se ha detenido/reconfigurado el API del usuario ni leído sus credenciales.

La actualización del servicio requiere instalar el paquete nuevo como root desde
SSH/consola independiente: reinicia el API y cierra sus PTYs. No repetir una
migración de identidad: un upgrade APT conserva `/etc/coreops` y `/var/lib/coreops`.
Sudo no interactivo sigue denegado en esta sesión; no se usará Docker para eludirlo.
No hay commit/push ni publicación APT para esta revisión visual.

Desde la raíz del checkout, en una SSH independiente:

```sh
sudo apt install ./dist/packages/coreops_0.1.0~dev20261123_amd64.deb
```

El servicio conservará identidad/configuración y reiniciará con la web nueva.
No ejecutar desde la propia Terminal CoreOps: prerm protege ese caso para no
matar al gestor de paquetes junto al API.
