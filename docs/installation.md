# Servicio del sistema y repositorio APT

## Estado — 2026-11-23

Existe un paquete `coreops` para amd64/arm64, instalador local, migración de la API
de desarrollo y generador de repositorio APT firmado. El usuario eligió APT propio.
No hay dominio/repositorio público ni clave de firma de producción configurados.
El proyecto tampoco declara una licencia de redistribución: los artefactos actuales
son de validación privada; elegir licencia y revisar avisos de dependencias antes
de distribuir. No se ha publicado ni hecho push. El usuario ya instaló el servicio
en el host de trabajo; la actualización requiere sudo interactivo.

## Reparación de Services tras la migración

La versión inicial del servicio dedicado omitía permisos para start/stop/restart;
systemctl solicitaba autenticación interactiva que la API no puede presentar.
El paquete `0.1.0~dev20261123.1` incluye el helper y la comprobación de permisos.
Desde este checkout, como pepe y en **SSH independiente de CoreOps**:

```sh
python3 scripts/install-system.py \
  --package dist/packages/coreops_0.1.0~dev20261123.1_amd64.deb \
  --add services
```

Solicita sudo, actualiza API/web/helpers y añade la capacidad a la política previa.
No repetir `--migrate-running`: identidad, sesiones y claves ya están migradas.
El reinicio de CoreOps cierra sus terminales activas. Si el paquete actualizado ya
está instalado, basta `sudo coreops-setup --add services`. Ningún comando anterior
arranca/detiene servicios ajenos a CoreOps como prueba de permisos.

## Instalación local con un comando

Ejecutar como **pepe, sin anteponer sudo**, desde el checkout. Requiere Go según
`backend/go.mod`, Node 22, pnpm 10, Python 3.11+, dpkg-deb y sudo:

```sh
python3 scripts/install-system.py --migrate-running \
  --enable docker,journal,power,security,security-timer,updates,tailscale,services
```

Construye web/API sin incorporar `.env` locales, genera el `.deb`, solicita sudo
para `apt-get install` y llama al configurador. La lista de permisos es explícita:
se pueden omitir capacidades. No instala Docker, sensores o Trivy automáticamente,
ni cambia SSH, firewall, Tailscale, paquetes del host o contenedores como prueba.
APT sí instala las dependencias declaradas del programa.

Para revisar sin instalar, detener ni copiar nada:

```sh
python3 scripts/install-system.py --dry-run --migrate-running \
  --enable docker,journal,power,security,security-timer,updates,tailscale,services
```

Para aprovechar el artefacto construido:

```sh
python3 scripts/install-system.py \
  --package dist/packages/coreops_0.1.0~dev20261123.1_amd64.deb \
  --migrate-running --enable docker,journal,power,security,security-timer,updates,tailscale,services
```

La configuración preserva el bind/puerto de la API origen (aquí loopback:8082).
Sin origen, el default es loopback:8082. **La UI web ya está incluida en ese puerto**;
no necesita Vite, Node ni tmux una vez instalada. El frontend de desarrollo en
5173 no se mata automáticamente; dejará de ser necesario cuando se utilice la URL
del servicio. Su proxy existente a loopback:8082 sigue funcionando si se conserva
ese bind.

Para acceso LAN deliberado, añadir `--bind 192.168.1.128 --port 8082` al comando
(dirección comprobada en este host; en otro equipo sustituirla). Esto cambia la
URL a `http://192.168.1.128:8082` y deja de servir el proxy Vite a loopback.
Para acceso remoto, preferir TLS con proxy/Tailscale Serve hacia loopback y elegir
la URL HTTPS en el móvil. No abrir puertos del firewall automáticamente. No se ha
configurado/publicado TLS en esta entrega.

## Instalación nueva y operación

En un equipo sin CoreOps:

```sh
sudo apt install ./coreops_VERSION_amd64.deb
sudo coreops-setup --admin admin --enable docker,journal,power,security,services
```

La contraseña se pide por terminal, se entrega al CLI por stdin y no se escribe en
argv, env ni un fichero de bootstrap. La instalación APT es no interactiva; el
servicio queda condicionado a `/etc/coreops/configured` hasta que exista identidad.
Si existe una unit legacy en /etc/systemd/system/coreops.service, respaldarla y
revisarla antes: setup rechaza sobrescribirla y comprueba también UID/GID reales.
Para automatizar una flota, aprovisionar la identidad mediante el CLI/secret manager
fuera del paquete y después ejecutar setup sin `--admin`. No hay contraseña común.

```sh
systemctl status coreops
journalctl -u coreops -f
curl http://127.0.0.1:8082/api/v1/health/live
/usr/bin/coreops-api version
sudo -u coreops env COREOPS_DATA_DIR=/var/lib/coreops /usr/bin/coreops-api user list
```

`/health/live` informa de proceso/versión/commit sin depender de Docker. El health
anterior conserva su 503 cuando Docker está inaccesible: no confundir proceso
activo con todas las integraciones disponibles. Setup comprueba MainPID, inode del
ejecutable instalado y liveness. Los builds locales indican `dirty` en su metadata.

| Ruta / identidad | Función |
| --- | --- |
| `/usr/bin/coreops-api` | Binario probado y versionado |
| `/usr/share/coreops/web` | Web estática, mismo listener y origen que API |
| `/usr/lib/systemd/system/coreops.service` | Servicio bajo usuario/grupo `coreops`, shell de login deshabilitada |
| `/etc/coreops/coreops.env` | Conffile dpkg privado, conservado en upgrade |
| `/etc/coreops/capabilities.json` | Selección de permisos persistida por setup |
| `/var/lib/coreops` | Identidad, sesiones, claves, audit, configs y cursor, privado |
| `/var/cache/coreops` | Cache de análisis reconstruible |
| `/usr/libexec/coreops` | Helpers root-owned del paquete, sin SUID |
| `/etc/sudoers.d/coreops-service` | Únicamente comandos exactos habilitados; validado con visudo |

`docker` añade el grupo existente; éste otorga autoridad amplia sobre el host.
`journal` añade systemd-journal/adm para registros/históricos. Los demás flags
habilitan exclusivamente sus helpers; security-timer está separado de lecturas.
Repetir setup conserva la política si se omite `--enable`; suministrarla reemplaza
la selección y retira los grupos administrados que ya no correspondan.
`--add services` añade sólo esa capacidad y conserva las demás; es excluyente
con `--enable`. Services habilita únicamente `coreops-services check|apply`,
para start/stop/restart de servicios persistentes de root. No concede sudo
genérico para systemctl. [Contrato y límites](modules/services.md).
Nunca se usan los helpers `/usr/local/libexec` de pepe para el servicio: el build
del paquete selecciona `/usr/libexec/coreops`; desarrollo conserva sus rutas.

Terminal se ejecuta como coreops. Files y cierre de sesiones SSH siguen sujetos a
permisos Unix: no se concede acceso general al home de pepe ni señales root a
procesos de otros usuarios. NoNewPrivileges/aislamiento de filesystem no pueden
activarse a ciegas mientras se necesitan sudo, Files, Terminal y paquetes reales.

## Migración y recuperación

`--migrate-running` exige exactamente una API del usuario actual; setup también
admite `--migrate-pid PID`. Captura configuración sin imprimir secretos, verifica
identidad del proceso y lo detiene por pidfd/SIGTERM. **Cierra PTYs/trabajos activos**:
no ejecutar durante una actualización de paquetes o trabajo que deba continuar.
Mantener acceso SSH independiente.

Tras detenerlo, bloquea identity/audit y copia **todos** los datos, incluidas claves
de Terminal, sesiones, archivos de audit y configs. Rechaza links/dispositivos y
migrar encima de otra identidad. El origen queda intacto como respaldo; no volver
a usar su CLI/API en paralelo porque sería una bifurcación de identidad. Archivos
referenciados de tokens se importan privados; no se conserva password de bootstrap.
Un Trivy ya configurado se copia root-owned a `/usr/local/lib/coreops/trivy`; su DB
no se duplica automáticamente (el cache observado era de 1,7 GiB), por lo que el
primer análisis puede necesitar descargarla de nuevo.

Backup root privado en `/etc/coreops/backup-FECHA-PID`. Si falla después de detener
el origen, intenta parar el servicio nuevo y restaurar la API previa con su UID,
grupos, binario, entorno y datos originales. No restaura operaciones de apt/dpkg ni
borra la copia migrada. Si también falla el rollback, informa y conserva los
respaldos para revisión. Comando manual de recuperación:

```sh
sudo coreops-setup --rollback-source /etc/coreops/backup-FECHA-PID
```

No reutilizar ese comando si la API previa ya está restaurada. Examinar el log
privado `source-restored.log` y resolver conflictos antes de otro intento.
Un import fallido con identidad ya copiada exige revisión; no se sobrescribe
silenciosamente con un segundo import.

Upgrade ordinario mediante APT desde una **SSH/consola independiente**, no desde
Terminal/Updates de CoreOps: detener su propia unit mataría también al gestor de
paquetes. `prerm` rechaza ese caso. Remove/purge conservan datos, archivos de
credenciales y cuenta para evitar perder claves/audit; purge retira marcador y
sudoers, y dpkg elimina el conffile coreops.env. Respaldar también ese archivo si
contiene configuración o tokens inline.
Eliminar respaldos/usuario/grupos restantes sólo después de una revisión explícita.
Para rollback de versión conservar el `.deb` anterior y usar `apt install
./VERSION_ANTERIOR.deb` revisando su compatibilidad; no se ha probado downgrade a
una versión histórica ni mezclar escritores de audit antiguos.

## Construcción y repositorio APT propio

```sh
python3 scripts/build-deb.py --version 0.1.0 --arch amd64
python3 scripts/build-deb.py --version 0.1.0 --arch arm64
python3 scripts/verify-deb.py dist/packages/coreops_0.1.0_amd64.deb
```

El builder no requiere root; Go estático, versión/commit/helper path por ldflags,
web con API same-origin y sin dotenv de desarrollo. Sólo entradas permitidas se
copian al staging, root:root, sin state/secretos/binarios generados en Git.
Build-info y SHA256 acompañan al artefacto. No se afirma reproducibilidad bit a bit
entre toolchains/entornos diferentes. Arm64 se compila e inspecciona; no se ha
ejecutado en hardware arm64.

Con una clave GPG de firma existente y protegida, usando su fingerprint completo:

```sh
python3 scripts/build-apt-repository.py dist/packages/*.deb \
  --output dist/apt-release-001 --sign-key FINGERPRINT_COMPLETO
# Siguiente generación: añadir --previous dist/apt-release-001 y usar otra salida.
```

Genera pool, índices amd64/arm64, SHA256/SHA512 by-hash, Release, InRelease y
Release.gpg, más clave pública export-minimal. Retiene paquetes/hash anteriores al
recibir --previous; prohíbe reemplazar el mismo nombre/versión con bytes distintos.
Release caduca en 14 días: regenerar y firmar antes aunque no haya otra versión.
Publicar el directorio completo mediante HTTPS, con cambio de generación atómico;
el script **no sube nada ni crea una clave de producción**.

Tras elegir dominio/alojamiento y publicar:

```sh
sudo python3 scripts/install-from-apt.py \
  --url https://apt.TU-DOMINIO --fingerprint FINGERPRINT_VERIFICADO
sudo coreops-setup --admin admin --enable docker,journal,power,security,services
# En adelante:
sudo apt update
sudo apt install coreops
sudo apt upgrade coreops
```

El instalador descarga la clave sólo por HTTPS y verifica un fingerprint primario
obtenido por un canal independiente antes de instalarla. Usa keyring dedicado,
deb822 Signed-By y pin para que este origen sólo aporte coreops; no apt-key,
trusted=yes ni desactivación de firmas. APT no descubre repositorios nuevos sólo
por el nombre de un paquete. [APT Secure oficial](https://manpages.debian.org/trixie/apt/apt-secure.8.en.html).

CI valida main/develop y ya no hace reset hard ni recompila un checkout por SSH.
`packages.yml` genera artefactos amd64/arm64 en PR/manual, sin firmar/publicar ni
guardar una clave privada en Git. La firma de una release revisada se hace en el
entorno que custodia la clave; automatizar su publicación depende del alojamiento
elegido. [Validación de esta entrega](system-install-validation-2026-11-22.md).
