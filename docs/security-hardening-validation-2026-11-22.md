# Endurecimiento y ampliación de Security — 2026-11-22

## Alcance y cambios

Rama develop confirmada; se preserva todo el trabajo anterior aceptado sin commit.
Esta entrega aplica los hallazgos del [informe previo](network-desktop-security-review-2026-11-22.md)
al slice Security. No implica cerrar todas las deudas históricas del registro
global, certificar un host libre de amenazas o actualizar automáticamente todas
las aplicaciones/paquetes que un scanner señale.

- Revalidación admin y efecto acotado bajo el flock de identidad: logout/cambio de
  rol se ordena antes o después del despacho, sin ventana entre guard y efecto.
- Intención audit durable previa, fallo cerrado, secuencia/cadena SHA-256, rotación
  8 MiB × cuatro archivos y endpoint de verificación admin. Legacy explícito;
  integridad local no sustituye firma/receptor externo. Archivos/alias/lock
  protegidos en Files y límite admin del catálogo de logs conservado.
- Cabeceras no-store/private para Security, incluidos errores/rechazos.
- Orígenes APT vinculados a distro/codename, exclusiones y estado desconocido si
  falta evidencia; motor, última ejecución/resultado y reinicio pendiente visibles.
- Consultas de jail detallada, nftables/Docker y sshd -T -C, con helper ampliado
  limitado, lectura separada y permisos desconocidos/denegados explícitos.
- Journal paginado older/newer con cursor, fuentes Tailscale/auth/sudo/kernel/audit/
  sensores; monitor cada 10 s y checkpoint privado durable que no avanza ante
  pérdida de evidencia/almacenamiento. Backlog continúa sin saltar páginas.
- Reglas de correlación acotadas y señales con IDs/fecha, sin diagnosticar una
  intrusión por una palabra ni dar por sano el host por una lista vacía.
- Trabajos CVE admin, identidad/objetivo frescos, confirmación y deduplicación en
  memoria. Scan real de inventario OS y SHA de imagen local, sin pull ni acciones
  Docker, entorno mínimo/salida acotada y DTO whitelisted sin env/config raw.
- CoreOps usa Go >=1.26.11 y x/sys 0.44.0; CLI Capacitor 8.6.2 y transitivos
  corregidos en el lockfile. Sin saltar Tailwind ni cambiar proyectos nativos.
  Script local y workflow de dependencias fallan ante avisos, incluso en tooling.

La arquitectura permanece en un proceso Go y frontend React. Nuevos puertos en
internal/security y adaptador securityscan, sin SDK en DTOs ni infraestructura en
el navegador. Guía y contratos en [Security](modules/host-security.md).

## Validación automatizada

- Suite Go completa con race correcta (cmd 182,219 s), más regresiones focalizadas
  posteriores de acciones/identidad/audit/alias/logs y vet/build finales correctos.
  Vet detectó una etiqueta JSON alterada al ampliar la protección de archivos de
  audit; se restauró el contrato y se repitieron controles relevantes.
- Pruebas nuevas: revoke durante evidencia, audit fallido sin efecto, logout
  serializado con la operación, roles/cache/queries, validación de evidencia, origen
  no security, cursor/backlog/checkpoint, regex/tiempo de señales, jobs/replay,
  inventario desconocido que no puede pasar limpio, whitelist de informe y
  retención/rotación/tamper/legacy/concurrencia/alias de auditoría.
- Web: build/formato/fronteras correctos. Suite de **163 escenarios**: 160 al primer
  intento y 3/3 repetidos tras ERR_NETWORK_CHANGED de carga de módulos, confirmado
  en las trazas (desktop Host, Terminal y plataforma Android simulada). No se
  cambiaron timeouts ni se ocultaron errores. Un intento anterior se canceló al
  detectar que el fixture aún no ofrecía el evento histórico en la nueva ruta;
  se actualizó ese fixture, preservando la expectativa del flujo.
- Nueve casos nuevos UI: postura/SSH y CVE a 320/1440 px, cursores y error con página
  anterior, operator sin acciones/audit, POST incierto sin retry, verificación de
  legacy/tamper y reset con reconocimiento de hueco. Primera ejecución focalizada
  16/17 más 1/1 repetido por ERR_NETWORK_CHANGED de Dashboard confirmado en traza.
- 13/13 pruebas Python de helpers (8 nuevas, 5 Tailscale existentes); AST, shell
  syntax y YAML CI correctos. Pruebas de root simuladas verifican allowlists,
  salida acotada, rechazo de privilegio/inputs y rollback anterior al reload.
  No equivalen a instalar/reconfigurar servicios privilegiados en este host.
- `scripts/security-check.sh`: govulncheck sin vulnerabilidades y pnpm audit sin
  avisos conocidos. Se usa formato normal/exit de govulncheck, no el JSON cuyo
  exit 0 podría contener findings. Esto es un scan puntual, no garantía futura;
  el workflow quedó preparado, no ejecutado en GitHub ni publicado por push.
- Cierre final: se regeneró el lockfile para retirar metadata overrides que ya
  no tenía configuración correspondiente; las versiones parcheadas permanecen.
  `pnpm install --frozen-lockfile`, audit y build volvieron a pasar. El ensayo
  SSH loopback con race se repitió con el guard actual y cerró sólo su sesión
  desechable mediante pidfd, conservando el listener dedicado.

## Herramienta e integración reales

Trivy v0.76.2 construido fuera del checkout con Go 1.27.4, módulo autenticado
`h1:RYBcQklHCFOHg/sfYSfe8v4/W5H2rAZrP5THPWY5F+A=` y commit
`3f6334d223b52188324af3b9923b4249cd206652`. Ejecutable privado confiable en
`/home/pepe/.coreops-tools/trivy`, cache `/home/pepe/.cache/coreops-trivy`.
La descarga directa de GitHub no estaba accesible desde el host; se empleó el
proxy/SumDB de Go, sin desactivar verificación. DB OCI oficial descargada desde
mirror.gcr.io, fecha observada **2026-11-22T12:38:44.47270345Z**.
[Release oficial](https://github.com/aquasecurity/trivy/releases/tag/v0.76.2),
[conectividad de Trivy](https://trivy.dev/docs/latest/advanced/air-gap/).

API y Vite aislados, admin/operator/viewer temporales y Chromium contra datos
reales. Lecturas: seis checks, APT, estado de sensores, journal con ida/vuelta de
cursor sin duplicados y monitor ok; viewer 403/operator 200. Cache-Control real
no-store/private. Auditoría de los scans validó su cadena. Cero errores JS o POST
Security desde el navegador; los dos POST computacionales de CVE fueron explícitos
por la integración. Sin operaciones de contenedor, firewall, SSH o paquetes.
Nodo/preferencias Tailscale sin cambios; identidades y procesos de validación
retirados. Capturas privadas en `/tmp/coreops-security-hardened-hcbww2yy/`.

Primer ensayo Trivy sin lsb-release no reconoció Ubuntu y el backend devolvió
fallo, no limpio. Se incorporó metadata distro necesaria y se repitió de verdad:

| Objetivo | Resultado |
| --- | --- |
| Host OS Ubuntu 26.04 | 1.594 paquetes compatibles, 6.694 advisories distintos; 54.820 pares paquete/advisory (770 critical, 12.132 high, 18.259 medium, 23.659 low), 50.552 pares con fix publicado |
| SHA local existente nginx:stable-alpine | 71 paquetes; scan correcto sin pull/recrear/arrancar/parar contenedores; 107 advisories distintos y 157 pares con fix publicado |

Estos son resultados del feed para versiones **instaladas**, no 54.820 exploits
confirmados. Muchos hallazgos críticos del host pertenecen a headers/módulos de
kernels antiguos 6.8 aún instalados; kernel cargado observado **7.0.0-43-generic**.
Las correcciones requieren triaje con proveedor/paquetes disponibles y versiones
realmente utilizadas. No eliminar kernels de respaldo ni cambiar imágenes en
servicio automáticamente. El informe prioriza 1.000 filas y mantiene contadores
completos; no mostrar 1.000 primeras filas alfabéticas ocultando las críticas.

El host tiene reboot-required. No se reinició ni se afirmó que todos sus parches
estén instalados por ver un timer activo. Planificar una ventana mediante Updates
y el centro de control, conservando una vía de acceso.

## Activación del host y estado efectivo

En esta validación auditd/ClamAV/Suricata/AIDE y otros agentes no están instalados.
El helper antiguo sigue resolviendo UFW/sshd/fail2ban básico; las consultas nuevas
jails/nft y Match vía helper requieren su actualización. Sudo solicita autenticación
local; no se usó Docker ni otro helper para eludirla. Código, instaladores y pruebas
están preparados para que el administrador ejecute pasos concretos:

```sh
sudo sh deploy/install-security-helper.sh pepe --allow-auto-updates
sudo python3 -I deploy/install-security-protection.py
# Tras verificar un acceso por clave nuevo como pepe desde el cliente:
sudo python3 -I deploy/harden-openssh.py apply pepe
```

El perfil de sensores instala paquetes de la distro y configura sus fuentes de
evidencia/timers con preflight de capacidad/backups. Es una activación operativa
manual, todavía no ensayada sobre estos servicios en el host. No equivale a tener
IDS/antimalware activos. SSH verifica sintaxis/permisos y prepara rollback de cinco
minutos antes de reload; rechaza Match sin revisar. Conservar sesión/consola y
comprobar nueva conexión antes del keep que imprime. Usuario solicitado: **pepe**.
No se pidió ni almacenó contraseña sudo; no se reutilizó una contraseña CoreOps.

## Runtime de desarrollo

API activa en tmux `%0`: `/tmp/coreops-security-runtime-1ayzi8m_/coreops-api`,
SHA-256 idéntico al binario probado, compilado con Go 1.26.11. Entorno/cwd y hashes
de users.json/sessions.json conservados; se añadieron sólo las dos variables del
scanner y frontend `%1` intacto. Health por proxy 5173: 200; nuevas rutas sin sesión
401. Launch JSON privado eliminado. No había procesos hijos del API al recargar.
Nueve escenarios UI nuevos volvieron a pasar tras el último ajuste CSS (9/9).
Monitor activo comprobado: checkpoint 0600, cursor presente y última recogida
reciente, sin imprimir el cursor ni leer credenciales para la verificación.
Sin build/sync APK, dispositivo físico, commit o push.
