# Autohospedaje de SaveCloud con Docker Compose

Esta guía te ayuda a elegir una forma de instalar SaveCloud y seguir los pasos en orden. Si no sabes cuál elegir, usa el asistente: te hará las preguntas necesarias y preparará Docker.

## Elige cómo vas a usar SaveCloud

| Modo                  | Elígelo si…                                                                  | Necesitas                                                          | Qué queda accesible                                                           |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **Local**             | Solo quieres probarlo en esta computadora.                                   | Docker y una licencia de MinIO AIStor.                             | La API, S3 y la consola MinIO solo desde esta computadora.                    |
| **VPS**               | Tienes un servidor con IP pública y quieres publicar SaveCloud directamente. | Dominio, IP pública y puertos TCP `80` y `443` abiertos.           | API y S3 a través de Caddy; la consola MinIO queda privada.                   |
| **Cloudflare Tunnel** | Quieres publicar SaveCloud sin abrir puertos entrantes.                      | Dominio con la zona activa en Cloudflare y un túnel de Cloudflare. | API y S3 a través del túnel; la consola MinIO queda solo en `127.0.0.1:9001`. |

Los tres modos usan el mismo asistente. En Windows, abre PowerShell en la carpeta del repositorio y ejecuta:

```powershell
.\scripts\docker-setup.ps1
```

En Linux/macOS:

```bash
bash scripts/docker-setup.sh
```

Elige **1 (local)**, **2 (VPS)** o **3 (Cloudflare Tunnel)**. Docker Compose descargará las imágenes necesarias y construirá SaveCloud; no tienes que usar `docker pull` ni ejecutar el comando `docker run` de Cloudflare por separado. Para los pasos de Cloudflare, ve a [Despliegue mediante Cloudflare Tunnel](#despliegue-mediante-cloudflare-tunnel).

### Dominio: DNS y registrador son cosas distintas

Para Tunnel, Cloudflare debe gestionar el DNS del dominio y mostrar la zona como **Active / Activa**. Si el dominio está en Name.com, eso se hace cambiando los nameservers por los que Cloudflare asignó. **No hace falta transferir el registro del dominio a Cloudflare Registrar**; esa transferencia es opcional y no es un requisito para Tunnel. Si registraste el dominio hace menos de 60 días, puede que tengas que esperar para transferirlo, pero puedes usar Cloudflare DNS y Tunnel mientras tanto.

Cuando publiques las dos rutas del túnel, Cloudflare creará los registros DNS correspondientes. No agregues registros A apuntando a una IP para el modo Tunnel.

### Requisitos comunes

- Docker Desktop (Windows) o Docker Engine con Docker Compose v2.24 o posterior.
- Una licencia de MinIO AIStor para esta instalación. Descarga `minio.license` desde [MinIO AIStor Pricing](https://www.min.io/pricing), guárdala en un lugar seguro y ten a mano su ruta. Cada persona debe obtener su propia licencia.
- Para el modo **Cloudflare Tunnel**, también necesitas un túnel y sus dos aplicaciones publicadas, según la sección de Cloudflare más abajo.

## Arquitectura y exposición de servicios

<details>
<summary>Ver detalles técnicos de redes, servicios y seguridad</summary>

| Servicio                            | Acceso desde contenedores | Acceso desde Internet                                                     |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| Caddy                               | `caddy:80/443`            | Local: sin puertos; VPS: `80/443`; túnel: sin puertos publicados          |
| Cloudflare Tunnel                   | `caddy:80`                | Solo conexiones salientes; ningún puerto publicado                        |
| SaveCloud API y WebSocket           | `savecloud-api:3000`      | Por Caddy; loopback en local/VPS; sin puertos con túnel                   |
| MinIO S3                            | `minio:9000`              | Por Caddy; loopback en local/VPS; sin puertos con túnel                   |
| Consola MinIO                       | `minio:9001`              | `127.0.0.1:9001` en todos los modos; nunca se expone por Caddy o el túnel |
| PostgreSQL (persistencia de la API) | `postgres:5432`           | Sin puerto publicado                                                      |
| Cola de eventos S3                  | `elasticmq:9324`          | Sin puertos publicados                                                    |

Compose separa la red de Caddy hacia la API (`proxy_upstreams`) de la red hacia S3/MinIO (`proxy_s3`). La API y MinIO también se comunican por `backend`, una red interna que contiene PostgreSQL, ElasticMQ y los workers; Caddy no pertenece a `backend`. En modo Tunnel, `cloudflared` comparte `tunnel_ingress` únicamente con Caddy. Los workers usan `backend` y, cuando consultan servicios externos, `worker_egress`; no se conectan a las redes de Caddy. La API usa `minio:9000` y `postgres:5432`; no usa `localhost` para hablar con otros contenedores. Las redes de proxy tienen subredes e IP de Caddy configuradas para confiar únicamente en el proxy esperado. Si esos rangos ya están ocupados por otra red o VPN, cambia `PROXY_API_SUBNET` y `TUNNEL_INGRESS_SUBNET` en `.env`, y conserva las IP correspondientes dentro de cada subred. Todas las tablas de persistencia de la API en Docker usan PostgreSQL. Caddy no necesita una dependencia de arranque respecto de la API: reintenta las conexiones al upstream cuando la API termina de iniciar.

En el modo VPS tradicional, Caddy termina TLS para `DOMAIN` y `s3.DOMAIN`, renueva los certificados y conserva su estado en `caddy_data` y `caddy_config`. En el modo Tunnel, Cloudflare termina TLS y reenvía a Caddy por HTTP dentro de la red privada de Docker. Caddy maneja el upgrade de WebSocket en ambos modos. El cliente se conecta a `wss://<DOMAIN>/ws` cuando configura la URL `https://<DOMAIN>`.

La API configura CORS con reflejo del origen solicitado (`@fastify/cors`, `origin: true`) y no usa cookies de sesión. `SYNC_GAMES_API_KEY` es la credencial del dueño; los invitados reciben tokens de acceso firmados de una hora y refresh tokens rotativos de treinta días, que el cliente guarda en el llavero del sistema. `ACCESS_TOKEN_SECRET` debe ser un secreto aleatorio distinto de la API key. El WebSocket autentica en el handshake mediante headers, nunca con credenciales en la URL. Fastify confía por defecto solo en la IP fija de Caddy dentro de `proxy_upstreams`. En modo Tunnel, Caddy solo acepta cabeceras de IP reenviada desde la IP de `cloudflared` dentro de `tunnel_ingress`.

En Docker, PostgreSQL almacena notificaciones, índice de archivos, estadísticas, conexiones, metadatos de clips, invitaciones y membresías, permisos de juegos compartidos, sesiones de acceso, inventarios de dispositivos, transferencias y tokens compartidos. Los archivos binarios de guardado y clips permanecen en S3/MinIO. El worker de expiración elimina en lotes notificaciones, invitaciones, sesiones, conexiones y tokens vencidos cada seis horas. `s3-events-worker` actualiza el índice y las estadísticas en PostgreSQL e invalida las cachés de la API antes de confirmar los mensajes. En AWS Serverless se mantienen los adaptadores DynamoDB y su TTL. ElasticMQ persiste la cola y los mensajes en `elasticmq_data` y usa long polling cuando la cola está vacía. En AWS se conserva el flujo S3 → SQS → Lambda.

</details>

## Requisitos adicionales para un VPS tradicional

- Un dominio y acceso para crear registros DNS.
- Puertos entrantes `80/tcp`, `443/tcp` y opcionalmente `443/udp` abiertos en el firewall del VPS y del proveedor. UDP 443 habilita HTTP/3; TCP 443 es suficiente para HTTPS.
- Espacio persistente para los volúmenes de datos de MinIO, PostgreSQL y Caddy.

### Configurar la licencia de MinIO AIStor

La imagen `quay.io/minio/aistor/minio` requiere una licencia activa. Obtén el archivo `minio.license` en [MinIO AIStor Pricing](https://www.min.io/pricing) y guárdalo fuera del repositorio. La licencia no se incluye ni distribuye con SaveCloud. Consulta también el [procedimiento de instalación oficial](https://docs.min.io/aistor/installation/container/install/?tab=download-image-docker#deploy-minio-container) y el [acuerdo AIStor Free](https://www.min.io/legal/aistor-free-agreement).

### Iniciar sesión en la consola de MinIO

La consola administrativa de MinIO está en `http://localhost:9001`. Inicia sesión con las credenciales de MinIO guardadas en `.env`:

- **Usuario / Access Key:** valor de `OBJECT_STORAGE_ACCESS_KEY`.
- **Contraseña / Secret Key:** valor de `OBJECT_STORAGE_SECRET_KEY`.

El asistente Docker genera estas credenciales si `.env` contiene valores de ejemplo. También genera `DATABASE_PASSWORD` para PostgreSQL. Usa los valores actuales de `.env`; no copies credenciales de ejemplo ni compartas las contraseñas. En una instalación VPS o Cloudflare Tunnel, el puerto `9001` solo escucha en el servidor. Para abrir la consola desde tu computadora, crea un túnel SSH y luego visita `http://localhost:9001`:

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

Este modo conecta Cloudflare con Caddy mediante una conexión saliente. No necesitas una IP pública fija ni abrir puertos de entrada en tu router o firewall. El frontend web del repositorio es un mock y no se despliega como servicio.

#### 1. Comprueba el dominio en Cloudflare

En Cloudflare, asegúrate de que `savecloud.example.com` (reemplázalo por tu dominio) aparece **Active / Activa**. Si aún no agregaste el dominio, elige **Conecta un dominio**, selecciona el plan gratuito y cambia en Name.com los nameservers por los dos que Cloudflare te asignó. No transfieras el registrador: no hace falta para este despliegue.

#### 2. Crea el túnel y las dos rutas

En el panel de Cloudflare, abre **Conexión de red / Networking → Túneles / Tunnels** y crea un túnel remoto. En **Rutas / Routes → Agregar ruta / Add route → Aplicación publicada / Published application**, crea estas dos rutas. En ambos casos, el servicio es `http://caddy:80` y el Host Header debe conservar el nombre público:

| Hostname público           | HTTP Host Header de origen | Servicio          |
| -------------------------- | -------------------------- | ----------------- |
| `savecloud.example.com`    | `savecloud.example.com`    | `http://caddy:80` |
| `s3.savecloud.example.com` | `s3.savecloud.example.com` | `http://caddy:80` |

El Host Header público permite que Caddy distinga la API de S3. No pongas `localhost` como servicio: Caddy y `cloudflared` se conectan entre sí por la red interna de Docker.

#### 3. Ejecuta el asistente

1. En Cloudflare, abre las instrucciones **Docker** del túnel y localiza el argumento `--token` del comando que se muestra. Copia **solo el valor del token**. No ejecutes ese `docker run`: SaveCloud iniciará `cloudflared` por ti.
2. Ejecuta el asistente de Windows o Linux/macOS indicado al inicio de esta guía y elige **3 (Cloudflare Tunnel)**.
3. Escribe el dominio raíz, por ejemplo `savecloud.games` (sin `https://`, `www` ni rutas). Confirma que configuraste los dos hostnames y pega el token cuando el asistente lo solicite. La entrada del token queda oculta y se guarda en `.env`.
4. Cuando el asistente termine, copia la clave API que muestra y configúrala en la app en **Configuración → Conexión de servidor**. Usa `https://<DOMAIN>` como URL.

El asistente genera las demás credenciales, valida Caddy, descarga las imágenes necesarias y levanta los contenedores. Si respondiste **No** a la pregunta sobre las rutas, puedes continuar, pero las direcciones públicas no funcionarán hasta agregarlas en Cloudflare.

**Prueba:** abre `https://<DOMAIN>/health`; debe responder correctamente. `https://s3.<DOMAIN>` es un endpoint S3 para la app, no una página web: abrir su raíz en el navegador puede mostrar `AccessDenied` y eso es normal. La consola administrativa de MinIO está en `http://127.0.0.1:9001` desde la misma computadora donde corre Docker; no se publica por Cloudflare ni para otros equipos de la red local.

Para actualizar la instalación después de cambiar el código, ejecuta `git pull` y sigue las instrucciones de actualización de [Usar los scripts automatizados](#usar-los-scripts-automatizados). En modo túnel, mantén `docker-compose.cloudflare.yml` en todos los comandos Compose manuales.

Comprueba el estado y los logs con los mismos archivos Compose:

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml ps
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml logs --tail=100 cloudflared caddy savecloud-api minio
```

Si aparece un `502`, confirma que el túnel figure como **Healthy**, que las dos aplicaciones publicadas apunten a `http://caddy:80` y que cada Host Header conserve el hostname público. Si una carga S3 devuelve `413`, el límite de tamaño de Cloudflare depende del plan; las cargas multipart de SaveCloud usan partes de 10 MiB.

El túnel no publica puertos del host para Caddy, API ni el endpoint S3. La consola administrativa de MinIO se enlaza únicamente a `127.0.0.1:9001`, para que se pueda abrir desde el propio servidor sin exponerla a la LAN ni a Internet. PostgreSQL y ElasticMQ permanecen en `backend`; Caddy no puede conectarse a ellos. Caddy tiene una red separada para API y otra para S3. `tunnel_ingress` solo conecta `cloudflared` con Caddy, y `worker_egress` permite a los workers llegar a servicios externos sin unirlos a las redes de proxy. El acceso de administración de Docker aún debe protegerse, ya que un usuario con acceso al daemon puede inspeccionar contenedores y redes.

Para volver al modo local, detén la pila del túnel y levanta solo el Compose base:

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml down
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build --remove-orphans
```

El override local conserva el acceso local por loopback y no publica Caddy. Si no quieres ofrecer el servicio público, elimina o desactiva los Public Hostnames del túnel en Cloudflare.

### Qué prepara el asistente

Ejecuta el asistente desde la carpeta raíz del repositorio con el comando del inicio de esta guía. Te pedirá el modo, los datos necesarios y la ubicación de `minio.license`. Si `.env` no existe, lo crea a partir de `.env.docker.example`. Completa el dominio y la dirección S3, genera credenciales si encuentra valores de ejemplo, selecciona el Compose correcto y espera a que la API, el almacenamiento y los workers estén listos. No tienes que editar `.env` ni descargar imágenes manualmente.

Al terminar, copia la API key que aparece en la terminal y guárdala en **Configuración → Conexión de servidor** en la app. La clave también está en `.env`; no compartas capturas o registros que la muestren.

`S3_PUBLIC_ENDPOINT` queda configurado según el modo: `http://localhost:9000` para local o `https://s3.<DOMAIN>` para VPS y Tunnel. La API lo usa para firmar las URLs de cargas y descargas. Dentro de Docker, la API siempre se conecta a `http://minio:9000`.

> [!TIP]
> Puedes revisar el desglose y propósito de cada variable en la [Guía de Variables de Entorno](ENVIRONMENT_VARIABLES.md).

### Usar los scripts automatizados

Los scripts validan primero el Caddyfile y después construyen e inician la pila. También eliminan el contenedor huérfano de DynamoDB Local y tratan de quitar su imagen, y esperan hasta dos minutos a que la API, el bucket y los workers estén listos. Leen `DEPLOYMENT_MODE`, `DOMAIN`, `S3_PUBLIC_ENDPOINT` y `API_PORT` de `.env`. El modo `local` aplica `docker-compose.local.yml`; el modo `cloudflare` aplica `docker-compose.cloudflare.yml` y espera a que `cloudflared` arranque; `vps` usa el Compose base.

Si ya configuraste `.env` y no necesitas el asistente, usa el script correspondiente para que respete el modo guardado. También puedes ejecutar Compose directamente: local con `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build --remove-orphans`, VPS tradicional con `docker compose up -d --build --remove-orphans`, o Tunnel con `docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d --build --remove-orphans`. `--remove-orphans` retira los contenedores del modo anterior.

La primera actualización desde una versión anterior separa las redes y reinicia los contenedores. El script lo detecta, avisa y pide confirmación; conserva los volúmenes con los datos. Si ejecutas Compose directamente, detén y elimina primero los contenedores y redes del proyecto con `docker compose ... down --remove-orphans` (usa los mismos archivos `-f` de tu modo, sin `-v`) y luego ejecuta el comando `up` correspondiente.

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
