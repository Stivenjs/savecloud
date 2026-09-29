# Autohospedaje de SaveCloud con Docker Compose

Esta guía cubre el uso local y el despliegue de SaveCloud en un VPS. En el VPS, Caddy publica la API por HTTPS y sirve como proxy del endpoint S3 para que las URLs presignadas funcionen desde la aplicación de escritorio.

## Arquitectura y exposición de servicios

| Servicio                  | Acceso desde contenedores | Acceso desde Internet                                                   |
| ------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| Caddy                     | `caddy:80/443`            | Puertos `80/tcp`, `443/tcp` y `443/udp`                                 |
| SaveCloud API y WebSocket | `savecloud-api:3000`      | Solo a través de Caddy; en el host, `127.0.0.1:3000` para desarrollo    |
| MinIO S3                  | `minio:9000`              | Solo a través de `https://s3.<DOMAIN>` en Caddy; `127.0.0.1:9000` local |
| Consola MinIO             | `minio:9001`              | Solo `127.0.0.1:9001`                                                   |
| DynamoDB Local            | `dynamodb-local:8000`     | Solo `127.0.0.1:8000`                                                   |

Compose crea una red privada y los servicios se encuentran por nombre DNS de servicio. La API usa `minio:9000` y `dynamodb-local:8000`; no usa `localhost` para hablar con otros contenedores. Caddy no tiene una dependencia de arranque respecto de la API: reintenta las conexiones al upstream cuando la API termina de iniciar.

Caddy termina TLS para `DOMAIN` y `s3.DOMAIN`, renueva los certificados y conserva su estado en los volúmenes `caddy_data` y `caddy_config`. El proxy inverso maneja automáticamente el upgrade de WebSocket. El cliente se conecta a `wss://<DOMAIN>/ws` cuando configura la URL `https://<DOMAIN>`.

La API configura CORS con reflejo del origen solicitado (`@fastify/cors`, `origin: true`) y no usa cookies de sesión. En todos los modos, la autenticación HTTP usa `API_KEY`, que Compose alimenta desde `SYNC_GAMES_API_KEY`; WebSocket valida la clave/token que envía el cliente en la query. TLS se termina en Caddy; Fastify tiene `trustProxy` habilitado para reconocer el protocolo y la IP reenviados.

## Requisitos del VPS

- Docker Engine con Docker Compose v2.24 o posterior.
- Un dominio y acceso para crear registros DNS.
- Puertos entrantes `80/tcp`, `443/tcp` y opcionalmente `443/udp` abiertos en el firewall del VPS y del proveedor. UDP 443 habilita HTTP/3; TCP 443 es suficiente para HTTPS.
- Una licencia MinIO AIStor para esta instalación. AIStor Free es de un solo nodo y cada usuario debe obtener su propia licencia.
- Espacio persistente para los volúmenes de datos de MinIO, DynamoDB y Caddy.

### Configurar la licencia de MinIO AIStor

La imagen `quay.io/minio/aistor/minio` requiere una licencia activa. Obtén el archivo `minio.license` en [MinIO AIStor Pricing](https://www.min.io/pricing) y guárdalo fuera del repositorio. La licencia no se incluye ni distribuye con SaveCloud. Consulta también el [procedimiento de instalación oficial](https://docs.min.io/aistor/installation/container/install/?tab=download-image-docker#deploy-minio-container) y el [acuerdo AIStor Free](https://www.min.io/legal/aistor-free-agreement).

## Despliegue en VPS

1. Clona el repositorio en el VPS y crea los registros DNS `A` para el dominio raíz y `s3` apuntando a la IP pública del VPS. Si configuras IPv6, crea los registros `AAAA` correspondientes. Ambos nombres deben resolver al VPS para que Caddy pueda emitir sus certificados.
2. Copia `.env.docker.example` a `.env` en la raíz del proyecto.
3. Configura al menos estos valores en `.env`:

```env
DOMAIN=savecloud.example.com
S3_PUBLIC_ENDPOINT=https://s3.savecloud.example.com
SYNC_GAMES_API_KEY=una-clave-larga-y-aleatoria
OBJECT_STORAGE_ACCESS_KEY=un-usuario-minio
OBJECT_STORAGE_SECRET_KEY=una-clave-minio-larga-y-aleatoria
MINIO_LICENSE_PATH=/ruta/absoluta/minio.license
```

`S3_PUBLIC_ENDPOINT` debe ser exactamente `https://s3.<DOMAIN>`. La API lo usa para firmar las URLs que descarga/sube la aplicación de escritorio. Su endpoint interno continúa siendo `http://minio:9000`. No uses `localhost` en `S3_PUBLIC_ENDPOINT` para un VPS: esa URL sería inaccesible para los clientes remotos.

4. Asegúrate de que el firewall permite TCP 80 y 443. UDP 443 es opcional para HTTP/3.
5. Desde la raíz del repositorio, inicia los servicios:

```bash
docker compose up -d
```

La primera ejecución construye la imagen de la API. El inicializador crea el bucket después de que la API esté saludable y el worker de Steam espera a que termine esa inicialización.

### Usar los scripts automatizados

Los scripts construyen e inician la pila con `docker compose up -d --build`, esperan hasta dos minutos a que la API esté saludable, a que termine la inicialización del bucket y a que arranque el worker. Al finalizar imprimen las URLs apropiadas para el modo local o VPS, además de los endpoints internos de Docker. Leen `DOMAIN`, `S3_PUBLIC_ENDPOINT` y `API_PORT` del entorno o del archivo `.env`.

Ejecuta el comando desde la raíz del repositorio, donde están `docker-compose.yml` y `.env`:

Windows PowerShell:

```powershell
.\scripts\docker-up.ps1
```

Linux/macOS:

```bash
bash scripts/docker-up.sh
```

En el VPS, la salida muestra `https://<DOMAIN>`, `wss://<DOMAIN>/ws` y el endpoint S3 configurado. En local muestra `http://localhost:<API_PORT>`, `ws://localhost:<API_PORT>/ws`, MinIO y DynamoDB en loopback. Si un servicio no queda listo, el script muestra el estado de Compose y los últimos registros de Caddy, API, MinIO, inicializador y worker, y termina con error.

Comprueba el estado y los registros:

```bash
docker compose ps
docker compose logs --tail=100 caddy savecloud-api create-bucket steam-seed-worker
```

Para confirmar la emisión del certificado busca en `docker compose logs caddy` mensajes que indiquen que el certificado de `savecloud.example.com` y `s3.savecloud.example.com` fue emitido/almacenado. También puedes consultar el endpoint HTTPS:

```bash
curl -I https://savecloud.example.com/health
```

En la aplicación de escritorio, ve a **Configuración → Conexión de servidor** y configura `https://savecloud.example.com` junto con `SYNC_GAMES_API_KEY`. La aplicación deriva la conexión WebSocket segura (`wss://`) desde la URL HTTPS. Las cargas y descargas presignadas usan `https://s3.savecloud.example.com`.

## Desarrollo local

La API conserva `http://localhost:3000` y la S3 API local `http://localhost:9000`; esos puertos se enlazan solo a la interfaz loopback del host. Crea `.env` desde `.env.docker.example` y para desarrollo cambia estas variables:

```env
DOMAIN=localhost
S3_PUBLIC_ENDPOINT=http://localhost:9000
```

La API key también es obligatoria localmente. Usa el mismo valor en `SYNC_GAMES_API_KEY` dentro de `.env` y en **Configuración → Conexión de servidor → Clave de acceso** en la aplicación de escritorio; Compose pasa ese valor a la API como `API_KEY`. Si las claves no coinciden, las solicitudes protegidas responderán `401`.

La consola MinIO sigue disponible en `http://localhost:9001`; DynamoDB Local, si se necesita desde herramientas del host, en `http://localhost:8000`. Para iniciar localmente:

```bash
docker compose up -d
```

También puedes usar los scripts automatizados de la sección anterior. En Windows ejecuta `.\scripts\docker-up.ps1`; en Linux/macOS ejecuta `bash scripts/docker-up.sh`. La salida confirma cuándo la API, el bucket y el worker están listos y muestra las URLs locales.

En el cliente de escritorio local configura `http://localhost:3000`; el WebSocket correspondiente usa `ws://localhost:3000/ws`. Los puertos de MinIO, su consola y DynamoDB no escuchan en interfaces públicas.

## Comprobación de servicios

```bash
docker compose ps
docker compose logs --tail=100 savecloud-api create-bucket steam-seed-worker
```

`savecloud-api` debe aparecer `Healthy`, `steam-seed-worker` debe permanecer activo y `savecloud-storage-bootstrap` puede aparecer como `Exited (0)`, porque es una tarea de inicialización. Desde la red de Compose, Caddy usa `savecloud-api:3000` y `minio:9000`; la API usa `minio:9000` y `dynamodb-local:8000`.

## Persistencia y comandos útiles

Compose persiste los objetos de MinIO, las tablas de DynamoDB y los certificados/configuración de Caddy en volúmenes nombrados. `docker compose down` conserva esos datos. Para ver los registros continuamente o detener la instalación:

```bash
docker compose logs -f
docker compose down
```

Para borrar de forma permanente los objetos, tablas y certificados guardados en los volúmenes:

```bash
docker compose down --volumes --remove-orphans
```

No uses `--volumes` si quieres conservar esos datos.
