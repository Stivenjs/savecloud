# Autohospedaje de SaveCloud con Docker Compose

Esta guía cubre el uso local y dos modalidades públicas de SaveCloud. El modo VPS tradicional publica Caddy en `80/443`; el modo Cloudflare Tunnel mantiene una conexión saliente y no requiere abrir puertos entrantes en el router o servidor.

## Arquitectura y exposición de servicios

| Servicio                            | Acceso desde contenedores | Acceso desde Internet                                                     |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| Caddy                               | `caddy:80/443`            | Local: sin puertos; VPS: `80/443`; túnel: sin puertos publicados          |
| Cloudflare Tunnel                   | `caddy:80`                | Solo conexiones salientes; ningún puerto publicado                        |
| SaveCloud API y WebSocket           | `savecloud-api:3000`      | Por Caddy; loopback en local/VPS; sin puertos con túnel                   |
| MinIO S3                            | `minio:9000`              | Por Caddy; loopback en local/VPS; sin puertos con túnel                   |
| Consola MinIO                       | `minio:9001`              | `127.0.0.1:9001` en todos los modos; nunca se expone por Caddy o el túnel |
| PostgreSQL (persistencia de la API) | `postgres:5432`           | Sin puerto publicado                                                      |
| Cola de eventos S3                  | `elasticmq:9324`          | Sin puertos publicados                                                    |

Compose separa la red de entrada a Caddy de la red interna de datos. `cloudflared` solo comparte la red de entrada con Caddy; PostgreSQL y ElasticMQ viven en la red interna, y Caddy no puede acceder a ellos. Los workers que consultan Steam también tienen una red de salida separada para sus solicitudes externas. La API usa `minio:9000` y `postgres:5432`; no usa `localhost` para hablar con otros contenedores. Todas las tablas de persistencia de la API en Docker usan PostgreSQL. Caddy no necesita una dependencia de arranque respecto de la API: reintenta las conexiones al upstream cuando la API termina de iniciar.

En el modo VPS tradicional, Caddy termina TLS para `DOMAIN` y `s3.DOMAIN`, renueva los certificados y conserva su estado en `caddy_data` y `caddy_config`. En el modo Tunnel, Cloudflare termina TLS y reenvía a Caddy por HTTP dentro de la red privada de Docker. Caddy maneja el upgrade de WebSocket en ambos modos. El cliente se conecta a `wss://<DOMAIN>/ws` cuando configura la URL `https://<DOMAIN>`.

La API configura CORS con reflejo del origen solicitado (`@fastify/cors`, `origin: true`) y no usa cookies de sesión. `SYNC_GAMES_API_KEY` es la credencial del dueño; los invitados reciben tokens de acceso firmados de una hora y refresh tokens rotativos de treinta días, que el cliente guarda en el llavero del sistema. `ACCESS_TOKEN_SECRET` debe ser un secreto aleatorio distinto de la API key. El WebSocket autentica en el handshake mediante headers, nunca con credenciales en la URL. Fastify confía en los headers reenviados solo desde Caddy y los rangos definidos en `TRUSTED_PROXY_CIDRS`.

En Docker, PostgreSQL almacena notificaciones, índice de archivos, estadísticas, conexiones, metadatos de clips, invitaciones y membresías, permisos de juegos compartidos, sesiones de acceso, inventarios de dispositivos, transferencias y tokens compartidos. Los archivos binarios de guardado y clips permanecen en S3/MinIO. El worker de expiración elimina en lotes notificaciones, invitaciones, sesiones, conexiones y tokens vencidos cada seis horas. `s3-events-worker` actualiza el índice y las estadísticas en PostgreSQL e invalida las cachés de la API antes de confirmar los mensajes. En AWS Serverless se mantienen los adaptadores DynamoDB y su TTL. ElasticMQ persiste la cola y los mensajes en `elasticmq_data` y usa long polling cuando la cola está vacía. En AWS se conserva el flujo S3 → SQS → Lambda.

## Requisitos del VPS

- Docker Engine con Docker Compose v2.24 o posterior.
- Un dominio y acceso para crear registros DNS.
- Puertos entrantes `80/tcp`, `443/tcp` y opcionalmente `443/udp` abiertos en el firewall del VPS y del proveedor. UDP 443 habilita HTTP/3; TCP 443 es suficiente para HTTPS.
- Una licencia MinIO AIStor para esta instalación. AIStor Free es de un solo nodo y cada usuario debe obtener su propia licencia.
- Espacio persistente para los volúmenes de datos de MinIO, PostgreSQL y Caddy.

### Configurar la licencia de MinIO AIStor

La imagen `quay.io/minio/aistor/minio` requiere una licencia activa. Obtén el archivo `minio.license` en [MinIO AIStor Pricing](https://www.min.io/pricing) y guárdalo fuera del repositorio. La licencia no se incluye ni distribuye con SaveCloud. Consulta también el [procedimiento de instalación oficial](https://docs.min.io/aistor/installation/container/install/?tab=download-image-docker#deploy-minio-container) y el [acuerdo AIStor Free](https://www.min.io/legal/aistor-free-agreement).

### Iniciar sesión en la consola de MinIO

La consola administrativa de MinIO está en `http://localhost:9001`. Inicia sesión con las credenciales de MinIO guardadas en `.env`:

- **Usuario / Access Key:** valor de `OBJECT_STORAGE_ACCESS_KEY`.
- **Contraseña / Secret Key:** valor de `OBJECT_STORAGE_SECRET_KEY`.

El asistente Docker genera estas credenciales si `.env` contiene valores de ejemplo. También genera `DATABASE_PASSWORD` para PostgreSQL. Usa los valores actuales de `.env`; no copies credenciales de ejemplo ni compartas las contraseñas. En una instalación VPS, el puerto `9001` solo escucha en loopback del servidor. Para abrir la consola desde tu computadora, crea un túnel SSH y luego visita `http://localhost:9001`:

```bash
ssh -L 9001:127.0.0.1:9001 usuario@IP_O_DOMINIO_DEL_VPS
```

## Despliegue en VPS

Esta sección describe el modo tradicional con DNS hacia la IP pública del VPS y puertos entrantes. Si vas a usar Cloudflare Tunnel, omite la configuración de IP/DNS/firewall y sigue la subsección **Despliegue mediante Cloudflare Tunnel**.

### Apuntar el dominio al VPS

Haz esta configuración en el panel donde administras el DNS del dominio (puede ser el panel del registrador o un proveedor DNS como Cloudflare). Busca una sección llamada **DNS**, **Zona DNS** o **Administrar registros**.

En los ejemplos siguientes, reemplaza `savecloud.example.com` por el dominio que compraste. Por ejemplo, si tu dominio es `miservidor.net`, usa `miservidor.net` para SaveCloud y `s3.miservidor.net` para el almacenamiento.

1. Obtén la **IP pública** del VPS en el panel de tu proveedor de alojamiento. Debe ser la IP pública del servidor, no `localhost`, una IP privada como `192.168.x.x` ni la IP de tu computadora.
2. Crea estos dos registros DNS tipo `A` y usa la misma IP pública del VPS:

   | Tipo | Nombre/Host | Valor/Apunta a                                 | Uso                                         |
   | ---- | ----------- | ---------------------------------------------- | ------------------------------------------- |
   | `A`  | `@`         | IP pública del VPS, por ejemplo `203.0.113.25` | API de SaveCloud en `savecloud.example.com` |
   | `A`  | `s3`        | La misma IP pública del VPS                    | S3 presignado en `s3.savecloud.example.com` |

   Algunos paneles usan el dominio completo en vez de `@`: en ese caso, escribe `savecloud.example.com` en el primer registro y `s3.savecloud.example.com` en el segundo. No escribas `https://`, puertos ni rutas en los campos DNS.

3. Si el VPS tiene una dirección IPv6 pública y está configurada para recibir tráfico, añade también registros `AAAA` para `@` y `s3` con esa dirección. Si no tienes IPv6 configurado, no añadas registros `AAAA`: un AAAA incorrecto puede hacer que algunos clientes intenten conectarse a una IP equivocada.
4. Para el modo tradicional, deja los registros como **DNS only / Solo DNS** al emitir los certificados de Caddy. El modo Cloudflare Tunnel no requiere registros A/AAAA hacia la IP del VPS; sigue la subsección de túnel.
5. Guarda los registros y espera a que se actualice el DNS. Comprueba desde tu computadora que ambos nombres resuelven:

   ```powershell
   nslookup savecloud.example.com
   nslookup s3.savecloud.example.com
   ```

   En Linux/macOS también puedes usar `dig +short savecloud.example.com` y `dig +short s3.savecloud.example.com`. En este modo tradicional, las respuestas deben mostrar la IP pública del VPS.

### Despliegue mediante Cloudflare Tunnel

Este modo usa un túnel remoto con token. `cloudflared` inicia conexiones salientes hacia Cloudflare y solo puede alcanzar Caddy por `tunnel_ingress`. Caddy enruta `DOMAIN` a `savecloud-api:3000` y `s3.DOMAIN` a `minio:9000`. El frontend web del repositorio es un mock y no se despliega como servicio.

En Cloudflare Zero Trust:

1. Crea un túnel en **Networks → Tunnels** y copia el token del conector.
2. Añade dos **Public Hostnames** al túnel. Para ambos configura el servicio de origen `http://caddy:80`:

   | Hostname público           | HTTP Host Header de origen | Servicio          |
   | -------------------------- | -------------------------- | ----------------- |
   | `savecloud.example.com`    | `savecloud.example.com`    | `http://caddy:80` |
   | `s3.savecloud.example.com` | `s3.savecloud.example.com` | `http://caddy:80` |

   El encabezado Host debe conservar el hostname público para que Caddy seleccione el upstream correcto. No configures `localhost` como origen: `cloudflared` y Caddy se descubren por nombre de servicio en la red Docker.

   El subdominio `s3` es el endpoint de la API S3, no una interfaz web. MinIO no redirige el acceso de navegador a la consola interna (`9001`), por lo que ese puerto no aparece en URLs públicas.

3. En el `.env` del servidor, establece `DOMAIN`, `S3_PUBLIC_ENDPOINT=https://s3.<DOMAIN>` y `CLOUDFLARE_TUNNEL_TOKEN`, además de los secretos requeridos y la licencia MinIO AIStor. Mantén el token fuera de Git y restringe el acceso al `.env` (en Linux/macOS, `chmod 600 .env`; en Windows, limita su ACL al usuario de instalación). El token permite ejecutar el túnel; rótalo en Cloudflare si se filtra.
4. Valida Compose y Caddy, y luego levanta la pila:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml config --quiet
   docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d --build --remove-orphans
   ```

   PowerShell usa los mismos comandos `docker compose` en una sola línea cada uno. Caddy usa `Caddyfile.cloudflare`, escucha HTTP solo dentro de Docker y no intenta emitir certificados del origen; Cloudflare termina HTTPS. No publiques puertos ni abras reglas entrantes del firewall para este modo.

5. En **Configuración → Conexión de servidor** de la app, usa `https://<DOMAIN>` y la `SYNC_GAMES_API_KEY`. Las cargas y descargas usan `S3_PUBLIC_ENDPOINT`; el WebSocket usa `wss://<DOMAIN>/ws`.

Para actualizar la instalación después de cambiar el código, ejecuta `git pull`, `docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml pull cloudflared caddy` y luego el comando `up -d --build --remove-orphans` de arriba. En modo túnel, sigue usando ambos archivos Compose para actualizar, consultar logs o detener la pila; los scripts `docker-up` existentes inician el modo base.

Comprueba el estado y los logs con los mismos archivos Compose:

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml ps
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml logs --tail=100 cloudflared caddy savecloud-api minio
```

Si aparece un `502`, confirma que el túnel figure como **Healthy**, que ambos Public Hostnames apunten a `http://caddy:80` y que el Host Header coincida con el hostname solicitado. Caddy admite WebSockets y conexiones persistentes. Si una carga S3 devuelve `413`, el límite de tamaño por solicitud de Cloudflare depende del plan; las cargas multipart de SaveCloud usan partes de 10 MiB. Para transferencias que superen el límite, aumenta el máximo permitido en Cloudflare o cambia al modo Caddy tradicional con DNS-only y puertos entrantes abiertos.

El túnel no publica puertos del host para Caddy, API ni el endpoint S3. La consola administrativa de MinIO se enlaza únicamente a `127.0.0.1:9001`, para que se pueda abrir desde el propio servidor sin exponerla a la LAN ni a Internet. PostgreSQL y ElasticMQ permanecen en la red interna `backend`; Caddy no puede conectarse a ellos. La red `tunnel_ingress` solo contiene `cloudflared` y Caddy. Los workers usan `worker_egress` para llegar a servicios externos sin entrar en la red de proxy. El acceso de administración de Docker aún debe protegerse, ya que un usuario con acceso al daemon puede inspeccionar contenedores y redes.

Para volver al modo local, detén la pila del túnel y levanta solo el Compose base:

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml down
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build --remove-orphans
```

El override local conserva el acceso local por loopback y no publica Caddy. Si no quieres ofrecer el servicio público, elimina o desactiva los Public Hostnames del túnel en Cloudflare.

6. Para el modo VPS tradicional, permite tráfico entrante TCP por los puertos `80` y `443`. UDP `443` es opcional y solo habilita HTTP/3. Si vas a usar Cloudflare Tunnel, sigue la sección anterior: no requiere esos puertos.

### Iniciar SaveCloud con el asistente

1. Clona el repositorio en el VPS. Ten a mano la IP pública, el dominio y el archivo de licencia MinIO AIStor.
2. Desde la raíz del repositorio, ejecuta el asistente según tu sistema:

Windows PowerShell:

```powershell
.\scripts\docker-setup.ps1
```

Linux/macOS:

```bash
bash scripts/docker-setup.sh
```

3. Elige el modo que quieras: **1 (local)**, **2 (VPS tradicional)** o **3 (Cloudflare Tunnel)**. Para VPS tradicional, introduce dominio/IP y prepara DNS y puertos. Para Tunnel, el asistente pide el dominio y el token de forma oculta; no necesitas IP pública fija ni abrir puertos. En Cloudflare Zero Trust configura ambos hostnames hacia `http://caddy:80`.
4. Cuando lo pida, introduce la ruta al archivo `minio.license`. Si no existe `.env`, el asistente la crea desde `.env.docker.example`. Actualiza `DOMAIN` y `S3_PUBLIC_ENDPOINT` y conserva las credenciales personalizadas existentes; si detecta valores de ejemplo o credenciales predeterminadas, genera valores aleatorios seguros.
5. El asistente guarda `DEPLOYMENT_MODE` en `.env`, inicia el Compose correcto, espera a que la API, el bucket, los workers y, en modo Tunnel, `cloudflared` estén activos. Muestra las URLs correspondientes y la API key que debes guardar en **Configuración → Conexión de servidor** en la app.

`S3_PUBLIC_ENDPOINT` queda configurado como `https://s3.<DOMAIN>`. La API lo usa para firmar las URLs de cargas y descargas. Su endpoint interno sigue siendo `http://minio:9000`.

> [!TIP]
> Puedes revisar el desglose y propósito de cada variable en la [Guía de Variables de Entorno](ENVIRONMENT_VARIABLES.md).

### Usar los scripts automatizados

Los scripts validan primero el Caddyfile y después construyen e inician la pila. También eliminan el contenedor huérfano de DynamoDB Local y tratan de quitar su imagen, y esperan hasta dos minutos a que la API, el bucket y los workers estén listos. Leen `DEPLOYMENT_MODE`, `DOMAIN`, `S3_PUBLIC_ENDPOINT` y `API_PORT` de `.env`. El modo `local` aplica `docker-compose.local.yml`; el modo `cloudflare` aplica `docker-compose.cloudflare.yml` y espera a que `cloudflared` arranque; `vps` usa el Compose base.

Si ya configuraste `.env` y no necesitas el asistente, usa el script correspondiente para que respete el modo guardado. También puedes ejecutar Compose directamente: local con `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build --remove-orphans`, VPS tradicional con `docker compose up -d --build --remove-orphans`, o Tunnel con `docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d --build --remove-orphans`. `--remove-orphans` retira los contenedores del modo anterior.

Windows PowerShell:

```powershell
.\scripts\docker-up.ps1
```

Linux/macOS:

```bash
bash scripts/docker-up.sh
```

En VPS y Tunnel, la salida muestra `https://<DOMAIN>`, `wss://<DOMAIN>/ws` y el endpoint S3; en local muestra `http://localhost:<API_PORT>`, `ws://localhost:<API_PORT>/ws` y MinIO. Si un servicio no queda listo, el script muestra el estado de Compose y los registros relevantes, incluyendo `cloudflared` en modo Tunnel, y termina con error.

Comprueba el estado y los registros:

```bash
docker compose ps
docker compose logs --tail=100 caddy savecloud-api create-bucket steam-seed-worker
docker compose logs --tail=100 s3-events-worker elasticmq
```

Para confirmar la emisión del certificado busca en `docker compose logs caddy` mensajes que indiquen que el certificado de `savecloud.example.com` y `s3.savecloud.example.com` fue emitido/almacenado. También puedes consultar el endpoint HTTPS:

```bash
curl -I https://savecloud.example.com/health
```

En la aplicación de escritorio, ve a **Configuración → Conexión de servidor** y configura `https://savecloud.example.com` junto con `SYNC_GAMES_API_KEY`. La API key pertenece al dueño y no se comparte con invitados; al aceptar una invitación, SaveCloud guarda una sesión individual en el llavero del sistema. La aplicación deriva la conexión WebSocket segura (`wss://`) desde la URL HTTPS. Las cargas y descargas presignadas usan `https://s3.savecloud.example.com`.

## Desarrollo local

La API conserva `http://localhost:3000` y la S3 API local `http://localhost:9000`; esos puertos se enlazan solo a la interfaz loopback del host. Caddy no publica puertos en modo local. Desde la raíz del repositorio, ejecuta el asistente y elige **1 (desarrollo local)**:

```powershell
.\scripts\docker-setup.ps1
```

En Linux/macOS:

```bash
bash scripts/docker-setup.sh
```

El asistente configura `DOMAIN=localhost`, `S3_PUBLIC_ENDPOINT=http://localhost:9000`, prepara `.env` si hace falta e inicia los servicios. La API key también es obligatoria localmente: el asistente la muestra al terminar para que la guardes en **Configuración → Conexión de servidor → Clave de acceso**. Si después ejecutas el script de arranque directamente, usa `bash scripts/docker-up.sh` o `.\scripts\docker-up.ps1`.

La consola MinIO sigue disponible en `http://localhost:9001`. Para iniciar localmente:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --remove-orphans
```

También puedes usar los scripts automatizados de la sección anterior. En Windows ejecuta `.\scripts\docker-up.ps1`; en Linux/macOS ejecuta `bash scripts/docker-up.sh`. La salida confirma cuándo la API, el bucket y el worker están listos y muestra las URLs locales.

En el cliente de escritorio local configura `http://localhost:3000`; el WebSocket correspondiente usa `ws://localhost:3000/ws`. Los puertos de MinIO y su consola no escuchan en interfaces públicas.

## Comprobación de servicios

```bash
docker compose ps
docker compose logs --tail=100 savecloud-api create-bucket steam-seed-worker
```

`savecloud-api` debe aparecer `Healthy`, `steam-seed-worker` debe permanecer activo y `savecloud-storage-bootstrap` puede aparecer como `Exited (0)`, porque es una tarea de inicialización. Desde la red de Compose, Caddy usa `savecloud-api:3000` y la API usa `minio:9000` y `postgres:5432`. El bootstrap permite lectura pública de objetos bajo `clips/` para que los clips compartidos puedan abrirse sin autenticación. No concede lectura pública a `clips-meta/` ni al resto del bucket.

## Persistencia y comandos útiles

Compose persiste los objetos de MinIO, los datos de PostgreSQL y los certificados/configuración de Caddy en volúmenes nombrados. `docker compose down` conserva esos datos. Para ver los registros continuamente o detener la instalación:

```bash
docker compose logs -f
docker compose down
```

Para borrar de forma permanente los objetos, tablas y certificados guardados en los volúmenes:

```bash
docker compose down --volumes --remove-orphans
```

No uses `--volumes` si quieres conservar esos datos.
