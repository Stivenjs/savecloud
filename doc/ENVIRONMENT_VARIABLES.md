# Guía Completa de Variables de Entorno: SaveCloud

Este documento especifica todas las variables de entorno de **SaveCloud**, organizadas por propósito, contexto de despliegue (**Docker VPS**, **AWS Serverless**, **Desarrollo Local**, **Testing/K6**) y nivel de obligatoriedad.

---

## Índice

1. [Archivos de Ejemplo en el Proyecto](#1-archivos-de-ejemplo-en-el-proyecto)
2. [Seguridad y Autenticación](#2-seguridad-y-autenticación)
3. [Red, Dominios y Proxies](#3-red-dominios-y-proxies)
4. [Almacenamiento de Objetos (S3 y MinIO)](#4-almacenamiento-de-objetos-s3-y-minio)
5. [Base de Datos (DynamoDB / DynamoDB Local)](#5-base-de-datos-dynamodb--dynamodb-local)
6. [Colas y Procesamiento Asíncrono (SQS y Workers)](#6-colas-y-procesamiento-asíncrono-sqs-y-workers)
7. [Observabilidad y Registro (Logs y Métricas)](#7-observabilidad-y-registro-logs-y-métricas)
8. [Pruebas de Carga y Rendimiento (K6)](#8-pruebas-de-carga-y-rendimiento-k6)
9. [Cliente de Escritorio y Crawler](#9-cliente-de-escritorio-y-crawler)
10. [Tabla Resumen por Entorno](#10-tabla-resumen-por-entorno)

---

## 1. Archivos de Ejemplo en el Proyecto

| Archivo                   | Propósito Principal                                                                                |
| :------------------------ | :------------------------------------------------------------------------------------------------- |
| **`.env.example`**        | Plantilla general para desarrollo local y configuración básica de AWS/Docker.                      |
| **`.env.docker.example`** | Plantilla recomendada para despliegue autohospedado en **VPS con Docker Compose + Caddy + MinIO**. |
| **`.env.k6`**             | Generado automáticamente por `bun run load:setup` para pruebas de estrés y rendimiento con k6.     |
| **`.env`**                | Archivo activo en local (ignorado por git). Contiene los secretos reales de tu instalación.        |

---

## 2. Seguridad y Autenticación

### `SYNC_GAMES_API_KEY` / `API_KEY`

- **Requerida en:** Docker VPS, AWS Lambda, CLI y Desktop.
- **Tipo:** String (secreto de alta entropía, p. ej. `sg_live_...` o UUID/hex de 64 caracteres).
- **Descripción:** Clave API maestra del anfitrión (dueño de la nube). Otorga privilegios administrativos absolutos a todos los endpoints de la API. Se envía en el header `x-api-key` o en `Authorization: Bearer <key>`.
- **Generación:** `bun run api-key` (para dev) o `bun run api-key:live` (para producción).

### `ACCESS_TOKEN_SECRET`

- **Requerida en:** Docker VPS y AWS Lambda.
- **Tipo:** String (mínimo 32 caracteres aleatorios en formato Base64URL o hexadecimal).
- **Descripción:** Secreto criptográfico HMAC-SHA256 utilizado exclusivamente para firmar y validar tokens de acceso temporales (`sc2`) de invitados a nubes compartidas.
- **⚠️ Seguridad crítica:** **Debe ser completamente diferente e independiente de `SYNC_GAMES_API_KEY`**. Si se compromete el token secret, solo se comprometen sesiones de invitados, mientras que la API key maestra permanece a salvo.

### `AUTH_LOG_SUCCESS`

- **Requerida en:** Opcional (AWS Lambda Authorizer).
- **Tipo:** Booleano (`true` | `false`, defecto: `false`).
- **Descripción:** Si está en `true`, el autorizador Lambda registra en CloudWatch cada autenticación exitosa. Se mantiene en `false` por rendimiento y reducción de costos de logs.

---

## 3. Red, Dominios y Proxies

### `DOMAIN`

- **Requerida en:** Docker Compose (VPS).
- **Tipo:** FQDN (ejemplo: `savecloud.tudominio.com`).
- **Defecto en local:** `localhost`.
- **Descripción:** Nombre de dominio del VPS. Caddy utiliza esta variable para solicitar y auto-renovar certificados SSL/TLS válidos de Let's Encrypt para `DOMAIN` y `s3.DOMAIN`.

### `S3_PUBLIC_ENDPOINT` / `PUBLIC_S3_ENDPOINT`

- **Requerida en:** Docker Compose (VPS y local con MinIO).
- **Tipo:** URL absoluta con protocolo (ejemplo: `https://s3.savecloud.tudominio.com` en VPS o `http://localhost:9000` en local).
- **Descripción:** URL pública con la que el servidor genera las URLs presignadas (PUT/GET) que entrega a los clientes de escritorio para subir/descargar partidas. Debe ser accesible desde la máquina del usuario final.

### `SYNC_GAMES_API_URL`

- **Requerida en:** CLI, Frontend Web, pruebas y scripts de integración.
- **Tipo:** URL absoluta (ejemplo: `http://localhost:3000` o `https://savecloud.tudominio.com`).
- **Descripción:** Dirección HTTP de la API a la que deben apuntar los clientes cuando no usan el modo autodescubrimiento.

### `API_PORT` / `PORT`

- **Requerida en:** Opcional.
- **Defecto:** `3000`.
- **Descripción:**
  - `PORT`: Puerto interno en el que Fastify escucha dentro del contenedor.
  - `API_PORT`: Puerto expuesto en loopback del host en `docker-compose.yml` (`127.0.0.1:${API_PORT:-3000}:3000`).

### `TRUSTED_PROXY_CIDRS`

- **Requerida en:** Docker Compose.
- **Defecto:** `172.16.0.0/12`.
- **Descripción:** Rangos CIDR de proxies inversos de confianza (como la red bridge de Docker donde opera Caddy). Fastify solo confía en las cabeceras `X-Forwarded-For` provenientes de estas IPs para identificar la IP real del cliente y aplicar los rate limits.

### `WS_BASE_URL` / `WS_ENDPOINT`

- **Requerida en:** AWS Lambda (WebSockets) o pruebas locales de sockets.
- **Tipo:** URL WebSocket (`wss://...` o `ws://...`).
- **Descripción:** Endpoint público del servicio de WebSockets para notificaciones y presencia en tiempo real.

---

## 4. Almacenamiento de Objetos (S3 y MinIO)

### `BUCKET_NAME`

- **Requerida en:** Todas las modalidades de despliegue.
- **Defecto en Docker:** `savecloud-saves`.
- **Descripción:** Nombre del bucket de S3 / MinIO donde se almacenan las partidas guardadas, metadatos empaquetados y capturas de video.

### `AWS_REGION`

- **Requerida en:** AWS Lambda.
- **Defecto:** `us-east-2` (AWS) o `us-east-1` (MinIO Docker).
- **Descripción:** Región geográfica del proveedor AWS para instanciar clientes de S3 y DynamoDB.

### `OBJECT_STORAGE_ACCESS_KEY` & `OBJECT_STORAGE_SECRET_KEY`

- **Requerida en:** Docker Compose (MinIO).
- **Defecto en local:** `minioadmin`.
- **Descripción:** Credenciales administrativas raíz para el contenedor MinIO. En producción VPS deben reemplazarse por contraseñas seguras y aleatorias.

### `MINIO_LICENSE_PATH`

- **Requerida en:** Docker Compose con imagen MinIO AIStor.
- **Tipo:** Ruta de archivo en el host (ejemplo: `./minio.license`).
- **Descripción:** Ruta al archivo de licencia oficial de MinIO AIStor Free (requerido por las versiones recientes de MinIO en contenedor).

### `S3_ENDPOINT`

- **Requerida en:** Docker Compose (interno entre contenedores).
- **Defecto:** `http://minio:9000`.
- **Descripción:** Endpoint interno por el cual la API se comunica directamente con MinIO a través de la red privada de Docker.

### `S3_FORCE_PATH_STYLE`

- **Requerida en:** Docker Compose (MinIO).
- **Defecto:** `true`.
- **Descripción:** Fuerza al SDK de AWS a construir URLs con estilo de ruta (`endpoint/bucket/objeto`) en lugar de subdominio virtual (`bucket.endpoint/objeto`). Es obligatorio para MinIO.

### `USE_ACCELERATE_ENDPOINT`

- **Requerida en:** Opcional (solo AWS S3).
- **Defecto:** `false`.
- **Descripción:** Si se activa (`true`), utiliza S3 Transfer Acceleration para optimizar las velocidades de carga y descarga de partidas entre continentes.

### `STEAM_SEED_PREFIX` & `STEAM_FILTERS`

- **Requerida en:** Opcional (Workers de catálogo de Steam).
- **Defecto:** `steam-seed`.
- **Descripción:** Prefijo de ruta en S3 para almacenar los manifiestos y plantillas de partidas sembradas desde Steam.

---

## 5. Bases de Datos (PostgreSQL y DynamoDB Local)

### PostgreSQL de la API

Docker Compose usa una conexión PostgreSQL compartida por la aplicación. PostgreSQL almacena las notificaciones y el índice de metadatos de archivos de guardado; las demás tablas locales continúan en DynamoDB. La conexión y sus opciones tienen nombres genéricos para que otros adaptadores puedan reutilizarla. El asistente `scripts/docker-setup` genera `DATABASE_PASSWORD` si falta o conserva el valor de ejemplo.

| Variable                               |  Requerida  | Defecto              | Propósito                                                                             |
| :------------------------------------- | :---------: | :------------------- | :------------------------------------------------------------------------------------ |
| `DATABASE_URL`                         | Alternativa | —                    | URL `postgres://` o `postgresql://`; si se define, reemplaza los campos individuales. |
| `DATABASE_HOST`                        |   Docker    | `postgres`           | Nombre DNS del servicio PostgreSQL.                                                   |
| `DATABASE_PORT`                        |  Opcional   | `5432`               | Puerto TCP PostgreSQL.                                                                |
| `DATABASE_USER`                        |  Opcional   | `savecloud`          | Usuario PostgreSQL.                                                                   |
| `DATABASE_PASSWORD`                    |   Docker    | Sin defecto          | Contraseña PostgreSQL.                                                                |
| `DATABASE_NAME`                        |  Opcional   | `savecloud`          | Base de datos PostgreSQL de la aplicación.                                            |
| `DATABASE_POOL_SIZE`                   |  Opcional   | `10`                 | Máximo de conexiones por proceso API.                                                 |
| `NOTIFICATIONS_EXPIRATION_INTERVAL_MS` |  Opcional   | `21600000` (6 horas) | Intervalo entre ciclos de limpieza de notificaciones vencidas.                        |

Los registros expiran a los 30 días. La API deja de devolverlos al vencer y el worker dedicado los elimina por lotes.

### DynamoDB Local

### `DYNAMODB_ENDPOINT`

- **Requerida en:** Docker Compose y desarrollo local.
- **Defecto en Docker:** `http://dynamodb-local:8000`.
- **Descripción:** Si está presente, la API sabe que está en entorno autohospedado/local y auto-crea las tablas de DynamoDB necesarias al iniciar. En AWS se omite para usar DynamoDB administrado por IAM.

### `DYNAMODB_ACCESS_KEY_ID` & `DYNAMODB_SECRET_ACCESS_KEY`

- **Requerida en:** Docker Compose y local.
- **Defecto:** `local`.
- **Descripción:** Credenciales ficticias exigidas por el SDK de AWS al interactuar con DynamoDB Local.

### Tablas de DynamoDB (Variables de Nombres)

En Docker Compose las variables de las tablas que siguen toman nombres por defecto predecibles. Las notificaciones y el índice de archivos ya no usan DynamoDB en Docker; AWS Serverless continúa usando `NOTIFICATIONS_TABLE` y `SAVE_FILES_INDEX_TABLE`. En AWS Serverless los nombres se inyectan desde `serverless.yml`:

| Variable de Entorno          | Valor por Defecto en Docker | Propósito                                                                                            |
| :--------------------------- | :-------------------------- | :--------------------------------------------------------------------------------------------------- |
| **`CLOUD_INVITES_TABLE`**    | `savecloud-cloud-invites`   | Invitaciones, membresías de nubes compartidas y **sesiones revocables (`sc2`/`scr1`)**.              |
| **`SAVE_FILES_INDEX_TABLE`** | No se usa                   | Índice de archivos de save en AWS Serverless; incluye rutas y metadatos de integridad.               |
| **`GAME_STATS_TABLE`**       | `savecloud-game-stats`      | Estadísticas por juego (horas jugadas, número de sincronizaciones, última actividad).                |
| **`CONNECTIONS_TABLE`**      | `savecloud-connections`     | IDs de conexión de WebSockets para presencia e invitaciones activas.                                 |
| **`NOTIFICATIONS_TABLE`**    | No se usa                   | Tabla de notificaciones en AWS Lambda y origen de datos para migrar instalaciones Docker existentes. |
| **`SHARE_TOKENS_TABLE`**     | `savecloud-share-tokens`    | Enlaces públicos temporales para compartir saves específicos con amigos.                             |
| **`GAME_INVENTORY_TABLE`**   | `savecloud-game-inventory`  | Catálogo de juegos detectados y sincronizados por cada usuario.                                      |
| **`CLIPS_TABLE`**            | `savecloud-clips`           | Metadatos de clips de video y capturas vinculadas a saves.                                           |

---

## 6. Colas y Procesamiento Asíncrono (SQS y Workers)

### `SQS_ENDPOINT`

- **Requerida en:** Docker Compose.
- **Defecto:** `http://elasticmq:9324`.
- **Descripción:** Endpoint local compatible con Amazon SQS provisto por ElasticMQ para encolar eventos de almacenamiento de S3/MinIO.

### `S3_EVENT_QUEUE_NAME` & `S3_EVENT_QUEUE_URL`

- **Requerida en:** Docker Compose (`s3-events-worker`).
- **Defecto:** `savecloud-s3-events` y `http://elasticmq:9324/000000000000/savecloud-s3-events`.
- **Descripción:** Nombre y URL de la cola donde MinIO emite notificaciones de creación de objetos para que el worker indexe los saves en segundo plano.

### `SEED_INTERVAL_MS`

- **Requerida en:** Docker Compose (`steam-seed-worker`).
- **Defecto:** `120000` (2 minutos).
- **Descripción:** Intervalo en milisegundos con el que el worker sondea y sincroniza catálogos y seeds de Steam.

---

## 7. Observabilidad y Registro (Logs y Métricas)

### `LOG_LEVEL`

- **Requerida en:** Opcional.
- **Valores posibles:** `fatal` | `error` | `warn` | `info` | `debug` | `trace`.
- **Defecto:** `warn` (en producción) o `info` (en desarrollo).
- **Descripción:** Controla el nivel de granularidad del logger Fastify/Pino.

### `HTTP_REQUEST_LOGS`

- **Requerida en:** Opcional.
- **Tipo:** Booleano (`true` | `false`, defecto: `false`).
- **Descripción:** Cuando se establece en `true`, la API imprime en stdout una línea JSON estructurada por cada petición HTTP con método, ruta, status code y tiempo de respuesta en milisegundos (`durationMs`).

### `DYNAMODB_OPERATION_METRICS`

- **Requerida en:** Opcional.
- **Tipo:** Booleano (`true` | `false`, defecto: `false`).
- **Descripción:** Habilita el registro de telemetría y conteo de operaciones ejecutadas contra DynamoDB.

---

## 8. Pruebas de Carga y Rendimiento (K6)

Estas variables se encuentran en `.env.k6` y se utilizan al ejecutar suites de prueba con `bun run load:test`:

### `USER_ID_PREFIX`

- **Tipo:** String.
- **Defecto:** `savecloud-k6-user`.
- **Descripción:** Prefijo común con el que el script de inicialización (`load:setup`) genera identidades de usuarios simulados.

### `USER_IDS`

- **Tipo:** String (lista separada por comas).
- **Descripción:** Lista exhaustiva de identificadores de usuarios sintéticos creados en la base de datos para simular concurrencia masiva en los tests de estrés.

### `USER_ID`

- **Tipo:** String (ejemplo: `LoadTestUser`).
- **Descripción:** ID de usuario estático utilizado para pruebas unitarias puntuales o diagnósticos rápidos de API.

---

## 9. Cliente de Escritorio y Crawler

Estas variables aplican al entorno de ejecución de la aplicación de escritorio (`apps/desktop`) o al motor de extracción web (`packages/crawler`):

### `STEAM_WEB_API_KEY`

- **Requerida en:** Opcional.
- **Descripción:** Clave oficial de la Web API de Steam. Si se configura, permite a la app de escritorio descargar iconos en alta resolución, banners y sinopsis directamente desde los servidores de Valve.

### `PYTHON`

- **Requerida en:** Opcional.
- **Descripción:** Ruta absoluta al ejecutable de Python (ejemplo: `C:\Python311\python.exe` o `/usr/bin/python3`). Se utiliza para el crawler stealth cuando no está en el `PATH` del sistema.

---

## 10. Tabla Resumen por Entorno

| Variable                        |   Docker VPS    | AWS Serverless  |    Dev Local    | Descripción Rápida                                 |
| :------------------------------ | :-------------: | :-------------: | :-------------: | :------------------------------------------------- |
| **`SYNC_GAMES_API_KEY`**        | **Obligatoria** | **Obligatoria** | **Obligatoria** | API Key maestra del dueño de la nube.              |
| **`ACCESS_TOKEN_SECRET`**       | **Obligatoria** | **Obligatoria** | **Obligatoria** | Secreto para firmar tokens `sc2` de invitados.     |
| **`DOMAIN`**                    | **Obligatoria** |       N/A       |    Opcional     | Dominio del VPS para certificados TLS con Caddy.   |
| **`S3_PUBLIC_ENDPOINT`**        | **Obligatoria** |       N/A       |    Opcional     | Endpoint S3 público entregado en URLs presignadas. |
| **`OBJECT_STORAGE_ACCESS_KEY`** | **Obligatoria** |       N/A       |    Opcional     | Usuario de MinIO.                                  |
| **`OBJECT_STORAGE_SECRET_KEY`** | **Obligatoria** |       N/A       |    Opcional     | Contraseña de MinIO.                               |
| **`MINIO_LICENSE_PATH`**        | **Obligatoria** |       N/A       |    Opcional     | Licencia de MinIO AIStor.                          |
| **`BUCKET_NAME`**               |   Automática    |   Automática    |   Automática    | Nombre del bucket para partidas y archivos.        |
| **`DYNAMODB_ENDPOINT`**         |   Automática    |       N/A       |   Automática    | Endpoint local para auto-crear tablas DynamoDB.    |
| **`DATABASE_PASSWORD`**         | **Obligatoria** |       N/A       |    Opcional     | Contraseña PostgreSQL del entorno Docker.          |
| **`DATABASE_URL`**              |    Opcional     |       N/A       |    Opcional     | URL PostgreSQL alternativa a `DATABASE_*`.         |
| **`API_PORT`**                  |    Opcional     |       N/A       |    Opcional     | Puerto de loopback en el host (`3000`).            |
| **`LOG_LEVEL`**                 |    Opcional     |    Opcional     |    Opcional     | Nivel de logs (`warn`, `info`, `debug`).           |
| **`HTTP_REQUEST_LOGS`**         |    Opcional     |    Opcional     |    Opcional     | Logs de duración y estado de cada solicitud HTTP.  |
