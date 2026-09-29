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

### Iniciar sesión en la consola de MinIO

La consola administrativa de MinIO está en `http://localhost:9001`. Inicia sesión con las credenciales de MinIO guardadas en `.env`:

- **Usuario / Access Key:** valor de `OBJECT_STORAGE_ACCESS_KEY`.
- **Contraseña / Secret Key:** valor de `OBJECT_STORAGE_SECRET_KEY`.

El asistente Docker genera estas credenciales si `.env` contiene valores de ejemplo. Usa los valores actuales de `.env`; no copies credenciales de ejemplo ni compartas la contraseña. En una instalación VPS, el puerto `9001` solo escucha en loopback del servidor. Para abrir la consola desde tu computadora, crea un túnel SSH y luego visita `http://localhost:9001`:

```bash
ssh -L 9001:127.0.0.1:9001 usuario@IP_O_DOMINIO_DEL_VPS
```

## Despliegue en VPS

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
4. Para el primer arranque, si tu proveedor DNS ofrece proxy/CDN, configura estos dos registros como **DNS only / Solo DNS**. Caddy debe poder recibir directamente las solicitudes HTTP y HTTPS para obtener los certificados; después podrás habilitar un proxy si este permite WebSockets y las cargas S3 que necesitas.
5. Guarda los registros y espera a que se actualice el DNS. Comprueba desde tu computadora que ambos nombres muestran la IP pública del VPS:

   ```powershell
   nslookup savecloud.example.com
   nslookup s3.savecloud.example.com
   ```

   En Linux/macOS también puedes usar `dig +short savecloud.example.com` y `dig +short s3.savecloud.example.com`. Si las respuestas todavía no muestran la IP del VPS, espera y vuelve a consultar antes de iniciar Caddy.

6. En el firewall del proveedor y del VPS, permite tráfico entrante TCP por los puertos `80` y `443`. UDP `443` es opcional y solo habilita HTTP/3. Si algún servicio ya está ocupando TCP `80` o `443`, Caddy no podrá atender el dominio ni emitir sus certificados.

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

3. Elige **2 (VPS)** e introduce tu dominio y la IP pública del VPS. El asistente muestra los registros `A` que debes tener configurados. Responde `S` si ya apuntaste ambos registros y abriste los puertos; si todavía no, puedes continuar, pero Caddy no obtendrá los certificados hasta que lo hagas.
4. Cuando lo pida, introduce la ruta al archivo `minio.license`. Si no existe `.env`, el asistente la crea desde `.env.docker.example`. Actualiza `DOMAIN` y `S3_PUBLIC_ENDPOINT` y conserva las credenciales personalizadas existentes; si detecta valores de ejemplo o credenciales predeterminadas, genera valores aleatorios seguros.
5. El asistente inicia la pila, espera que la API, el bucket y el worker estén listos, y muestra la API HTTPS, WebSocket seguro y endpoint S3. También muestra la API key que debes guardar en **Configuración → Conexión de servidor** en la app.

`S3_PUBLIC_ENDPOINT` queda configurado como `https://s3.<DOMAIN>`. La API lo usa para firmar las URLs de cargas y descargas. Su endpoint interno sigue siendo `http://minio:9000`.

### Usar los scripts automatizados

Los scripts construyen e inician la pila con `docker compose up -d --build`, esperan hasta dos minutos a que la API esté saludable, a que termine la inicialización del bucket y a que arranque el worker. Al finalizar imprimen las URLs apropiadas para el modo local o VPS, además de los endpoints internos de Docker. Leen `DOMAIN`, `S3_PUBLIC_ENDPOINT` y `API_PORT` del entorno o del archivo `.env`.

Si ya configuraste `.env` y no necesitas el asistente, ejecuta desde la raíz del repositorio `docker compose up -d` o usa el script correspondiente. Los scripts construyen e inician la pila; ejecuta desde la raíz, donde están `docker-compose.yml` y `.env`:

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

La API conserva `http://localhost:3000` y la S3 API local `http://localhost:9000`; esos puertos se enlazan solo a la interfaz loopback del host. Desde la raíz del repositorio, ejecuta el asistente y elige **1 (desarrollo local)**:

```powershell
.\scripts\docker-setup.ps1
```

En Linux/macOS:

```bash
bash scripts/docker-setup.sh
```

El asistente configura `DOMAIN=localhost`, `S3_PUBLIC_ENDPOINT=http://localhost:9000`, prepara `.env` si hace falta e inicia los servicios. La API key también es obligatoria localmente: el asistente la muestra al terminar para que la guardes en **Configuración → Conexión de servidor → Clave de acceso**. Si después ejecutas el script de arranque directamente, usa `bash scripts/docker-up.sh` o `.\scripts\docker-up.ps1`.

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

`savecloud-api` debe aparecer `Healthy`, `steam-seed-worker` debe permanecer activo y `savecloud-storage-bootstrap` puede aparecer como `Exited (0)`, porque es una tarea de inicialización. Desde la red de Compose, Caddy usa `savecloud-api:3000` y `minio:9000`; la API usa `minio:9000` y `dynamodb-local:8000`. DynamoDB Local usa credenciales simuladas independientes (`local`/`local`); las credenciales aleatorias de `.env` son para MinIO.

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
