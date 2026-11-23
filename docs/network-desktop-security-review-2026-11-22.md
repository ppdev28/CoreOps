# Network desktop y revisión del slice Security — 2026-11-22

## Resultado y alcance

Network mejora sólo mediante CSS desde 1024 px: controles en dos filas, búsqueda
ancha, agrupación alineada con el título, panel delimitado, más espacio interior,
etiquetas/inputs legibles y foco visible. Sin modificar filtros, API, tabla o
comportamiento móvil. Controles: 227 → 185 px de altura a 1024/1440/1920 px;
capturas PNG idénticas antes/después a 320/390/768 px. El panel completo también
se inspeccionó con bindings reales; sin overflow o errores JS.

Security **funciona como panel de evidencias de configuración y sesiones**, pero
**no detecta todas las amenazas ni vulnerabilidades**. Se revisaron núcleo,
adaptador/comandos/procfs/logind, handlers/roles/audit, UI, helper/instalador y tests.
Se verificó con API/identidad temporal y herramientas Linux reales. No se
modificaron políticas de SSH, UFW, fail2ban, APT, permisos ni sesiones del usuario.
No se instaló un escáner ni se actualizaron dependencias/toolchain.

## Evidencia del servidor actual

| Fuente | Resultado observado | Qué demuestra |
| --- | --- | --- |
| UFW | Activo, 15 reglas parseadas | Estado UFW; no corrección de reglas ni cobertura Docker/NAT/Internet |
| OpenSSH global | PasswordAuthentication yes; PermitRootLogin prohibit-password | La vista marca dos comprobaciones con atención; esa directiva permite claves root, pero no se probó un login ni se resolvieron Match/AllowUsers u otros controles efectivos |
| fail2ban | Responde, una jail: sshd | No verifica individualmente filtro, acciones de ban, umbral o bloqueo efectivo |
| Actualizaciones | APT periodic lists/upgrade habilitados y apt-daily-upgrade.timer active/enabled | Programación; no confirma instalación reciente, todos los parches o ausencia de errores |
| Sockets | 74 endpoints TCP/UDP en la captura Security | Inventario local del namespace, sin medir accesibilidad externa |
| Sesiones | Fuente ok, cero sesiones soportadas detectadas | No demuestra ausencia de conexiones de cualquier implementación o de forwarding Tailscale |
| Eventos | 107 registros válidos de la consulta acotada; fuente ok | Subconjunto OpenSSH/fail2ban del journal, sin certificar todo el host |

Todas las fuentes de esta consulta respondieron ok. El helper Security ya
instalado permite las consultas privilegiadas; esta entrega no lo instaló ni
cambió. El antiguo error de /run/sshd descrito en noviembre 16 no se reprodujo.
Consulta directa del helper corroboró los valores SSH y la jail sshd.

Network mostró 75 bindings en la prueba posterior: el Vite temporal de validación
ya había añadido un listener de loopback. No comparar snapshots tomados en
momentos distintos como si fueran una inconsistencia del parser.

## Hallazgos y pendientes, por prioridad

### P1 — acciones Security sin revalidación tras recoger evidencia (SEC-13)

`backend/cmd/coreops-api/auth.go:486` autoriza al entrar. Los handlers
`security.go:78` y `security.go:93` llaman al servicio sin un guard de autorización
inmediatamente previo al despacho. El núcleo puede consultar procfs/comandos
antes de señalar/habilitar el temporizador. Un logout o retirada de permisos en
esa ventana no vuelve a consultarse. La identidad del proceso objetivo sí se
revalida: son garantías distintas.

Reproducción aislada: un Source falso revoca la sesión CoreOps al devolver el
inventario; el handler aún devuelve 202 y llama una vez al Signal falso. El token
ya no autentica. No se señaló ningún PID real. Corrección pendiente: revalidar
actor/rol antes del efecto privilegiado, con tests para logout/cambio de rol.

### P1 — fallo de auditoría no bloquea el cambio (SEC-06)

`backend/cmd/coreops-api/security.go:78` ejecuta antes de agregar el detalle de
audit. `audit.go:180` registra después; Append sólo escribe un error en slog ante
un fallo de disco. Las acciones de este slice no usan AppendDurable antes de
Signal/EnableAutoUpdates, como ya hacen capacidades más recientes.

Reproducción aislada con directorio de audit inexistente: Signal falso se ejecuta
y HTTP sigue en 202. El error de escritura se observa en log. Falta intención
durable previa al despacho y política explícita ante fallos/retención/integridad.
No atribuir esta garantía a Security por existir en Tailscale/energía.

### P1 — avisos de dependencias y toolchain (SEC-14)

El binario activo `/tmp/coreops-tailscale-runtime-_2hh1cds/coreops-api` fue compilado
con **go1.26.8**, verificado con `go version`. `govulncheck v1.10.0`, análisis source
symbol y DB vuln.go.dev modificada 2026-11-11, devuelve **16 IDs distintos**, **13
con trazas de símbolos**. El modo JSON acabó con exit 0 pese a findings; se analizó
el contenido, no sólo el código de salida.

| IDs | Alcance que requiere triaje |
| --- | --- |
| GO-2026-6603, 6610, 6611, 6612, 6617 | HTTP/2: memoria, CPU, control de flujo y race. El servidor CoreOps actual usa ListenAndServe HTTP/1 en loopback; no demuestra exposición a ataques de servidor HTTP/2 |
| GO-2026-6605, 6608, 6609, 6613, 6859 | Paths HTTP/MIME/Range/CONNECT en stdlib. El aviso 6859 requiere concurrencia de lectura de body y escritura de headers; el uso de símbolos por sí solo no demuestra esa condición |
| GO-2026-6607, 6809 | TLS/X509; depende de conexión/configuración y certificados aplicables |
| GO-2026-6604 | Junctions Windows; no transferir ese riesgo directamente al host Linux aunque el scanner encuentre símbolos os compartidos |
| GO-2026-6599, 6600; GO-2026-5024 | Sólo coincidencia de módulo: html/template y x/sys/windows, sin traza de llamada encontrada |

Los IDs stdlib consultados tienen correcciones hasta **Go 1.26.11**. Se necesita
actualizar a un patch soportado, recompilar y volver a escanear en otra entrega;
no se instalaron versiones ni se sustituyó el API durante esta revisión. Esto no
son 16 exploits confirmados. Referencias: [Go vuln tooling](https://go.dev/doc/security/vuln/),
[HTTP/1 MaxBytesReader, GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859),
[HTTP/2 Trailer, GO-2026-6603](https://pkg.go.dev/vuln/GO-2026-6603),
[releases oficiales](https://go.dev/doc/devel/release).

`pnpm audit --json` devuelve **4 avisos transitivos, 1 high y 3 moderate**.
`pnpm why` sitúa las cuatro rutas afectadas en **devDependencies**; no se ha
probado explotación en el bundle web. La consulta separada `pnpm audit --prod`
terminó con exit 0 y cero avisos conocidos para sus 100 dependencias; es un
resultado puntual del registry, no una garantía general. El resultado global cuenta
290 dependencias y no clasifica correctamente esa distinción por sí solo.

| Dependencia instalada / ruta | Severidad del advisory | Corrección indicada |
| --- | --- | --- |
| source-map-js 1.2.1 ← @tailwindcss/node ← @tailwindcss/vite | high: DoS de event loop | >=1.2.2; [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| uuid 7.0.3 ← xcode ← @capacitor/cli | moderate: bounds en APIs con buffer | >=11.1.1; [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| glob 13.0.6 ← rimraf ← @capacitor/cli | moderate: cancelación de traversal | >=14.0.2; [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| minimatch 10.2.6 ← glob ← rimraf ← @capacitor/cli | moderate: DoS | >=11.0.1; [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

Las versiones de la última columna pertenecen a las dependencias transitivas:
revisar compatibilidad/actualización upstream antes de imponer saltos mayores.
No se modificaron package.json, pnpm-lock.yaml, go.mod o go.sum. Los escaneos son
puntuales, no un nuevo control CI ni inventario CVE de paquetes/imágenes del host.

### P2 — cobertura de eventos y postura parcial

- `commands.go:103`: journalctl consulta sólo ssh.service, sshd.service, ssh.socket
  y fail2ban.service, últimos 120 registros en cada snapshot. La UI refresca cada
  15 s sin cursor/acumulación. Faltan tailscaled, kernel/UFW, auditd, auth/sudo de
  otras unidades, integridad de archivos, malware/IDS y correlación de incidentes.
  Una ráfaga puede quedar fuera de la ventana; ok significa consulta correcta,
  no cobertura completa ni ausencia de amenazas.
- `checks.go:88`: APTPolicy sólo evalúa las banderas periódicas. El test de revisión
  reprodujo un Pass del check de Auto security updates con un origen Example:custom
  y ningún origen security. Falta revisar Allowed-Origins/Origins-Pattern,
  blacklists, ejecuciones/errores y reinicio pendiente. En el host actual no se
  demostró una política de orígenes defectuosa.
- UFW activo no evalúa DOCKER-USER/nftables, reglas/rutas de Tailscale, NAT o firewall
  externo; Docker advierte que los puertos publicados pueden eludir UFW.
  [Referencia Docker](https://docs.docker.com/engine/network/packet-filtering-firewalls/).
- SSH se evalúa con sshd -T global, sin sshd -T -C por usuario/origen ni política
  Tailscale SSH. Las sesiones Tailscale sin PTY siguen fuera del inventario.
- fail2ban pasa con cualquier jail; el slice no revisa si cubre el servicio/origen
  que se pretende proteger. Auto-updates depende también de orígenes reales:
  [documentación Ubuntu](https://ubuntu.com/server/docs/how-to/software/automatic-updates/).

### P2 — cabeceras de datos sensibles (SEC-11)

GET /api/v1/security no establece Cache-Control: no-store/private; confirmado en
HTTP real. Contiene usuarios, orígenes y mensajes. Definir política junto al proxy
para evitar almacenamiento no deseado. No se intentó explotar una caché ni se
alteraron headers como parte de la mejora visual.

## Controles comprobados y pruebas

- Roles: 401 anónimo; viewer 403; operator puede consultar, sin modificar; admin
  sujeto además a capacidad real del SO. HTTP/roles/IDs y auditoría nominal
  cubiertos por los tests existentes, con regresiones del core/adaptador.
- Identidad SSH fresca, ejecutables confiables, protección de ancestros y pidfd
  SIGTERM; sin kill numérico/SIGKILL/sudo para procesos. Ensayo opt-in con servidor
  y conexión SSH **propios**, claves temporales, loopback: detectó notty real,
  señaló exclusivamente esa conexión con pidfd, confirmó cierre y conservó el
  listener propio hasta limpiarlo. Ninguna sesión existente fue señalada.
- Fuentes independientes ok/partial/permission_denied/unavailable/error; no se
  convierten fallos en inactive/healthy. UI conserva evidencia anterior marcada y
  bloquea acciones si falla el refresco; distingue 202 de cierre verificado.
- Comandos de argv fijo, entorno limpio, límites de salida y deadlines. Helper
  root-owned con consultas y permiso de timer separados; no proxy libre.
- Go: race de security/linuxsecurity y tests HTTP/parser relacionados correctos;
  3 reproducciones adicionales por overlay Go temporal correctas, sin archivos
  de prueba añadidos al checkout ni host mutado por sus fuentes falsas.
- Web: fronteras/formato/build correctos; **16/16** escenarios focalizados
  security.spec.ts + usability.spec.ts, sin retry. Revisión visual a seis anchos,
  comparación exacta de PNG móviles y API/Chromium sin fixtures para Security y
  Network: cero errores JS, cero POST de Security (bloqueados si aparecían).

API/Vite de integración y cuentas generadas retirados. Artefactos privados:
`/tmp/coreops-security-review-_2w7idma/`; comparativas de filtros en
`/tmp/coreops-network-desktop-review/`; logs de pruebas/scanners fuera de Git.
No se usaron credenciales del usuario. Nodo/preferencias Tailscale iguales antes
y después. El API de desarrollo existente se conserva; Vite 5173 sirve el CSS.
Sin build nativo, commit, push, cambio de rama o corrección de Security solicitados.
