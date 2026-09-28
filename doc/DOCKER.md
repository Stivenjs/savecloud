# Autohospedaje de SaveCloud con Docker Compose

Esta guía describe cómo iniciar SaveCloud localmente o en un servidor propio con Docker Compose.

## Servicios

- **SaveCloud API**: API HTTP y WebSocket en el puerto `3000`.
- **MinIO AIStor**: almacenamiento compatible con S3 en el puerto `9000` y consola web en `9001`.
- **DynamoDB Local**: base de datos local en el puerto `8000`.
- **Storage bootstrap**: inicializador de una sola ejecución que crea el bucket y configura CORS, expiración de objetos y eventos S3.
- **Steam Seed worker**: proceso periódico que inicia después de que el bucket esté preparado.

## Requisitos

- Docker Desktop con Docker Compose v2.24 o posterior en Windows, o Docker Engine con el plugin Docker Compose en Linux.
- Una licencia MinIO AIStor para esta instalación local. AIStor Free no tiene costo para despliegues de un solo nodo.

## Obtener y configurar la licencia de MinIO AIStor

El servicio local usa la imagen `quay.io/minio/aistor/minio`. AIStor necesita una licencia activa para habilitar las operaciones S3; la imagen por sí sola no incluye una licencia.

1. Abre [MinIO AIStor Pricing](https://www.min.io/pricing) y selecciona **Get Started Free** en el plan Free.
2. Completa el proceso de solicitud de MinIO y descarga el archivo de licencia `minio.license`.
3. Guarda el archivo en la raíz de este repositorio, junto a `docker-compose.yml`. El repositorio ignora `minio.license` para evitar subirlo a Git.
4. Añade estas variables a tu archivo `.env` en la raíz del proyecto:

```env
MINIO_LICENSE_PATH=./minio.license
OBJECT_STORAGE_ACCESS_KEY=un_usuario_local
OBJECT_STORAGE_SECRET_KEY=una_clave_local_larga
SYNC_GAMES_API_KEY=una_clave_api_personalizada
```

Si la licencia está en otra ubicación, asigna a `MINIO_LICENSE_PATH` la ruta absoluta. En Windows usa barras `/`, por ejemplo `C:/Users/tu_usuario/Downloads/minio.license`.

La licencia Free es para un despliegue individual de un solo nodo. Cada usuario debe obtener su propia licencia; no se incluye ni se distribuye con SaveCloud. Consulta el [procedimiento oficial de instalación en contenedores](https://docs.min.io/aistor/installation/container/install/?tab=download-image-docker#deploy-minio-container) y el [acuerdo AIStor Free](https://www.min.io/legal/aistor-free-agreement).

## Iniciar SaveCloud y mostrar sus URLs

Los scripts de inicio construyen la pila, esperan a que la API esté saludable, a que `storage-bootstrap` termine y a que el worker esté activo. Al final imprimen todas las URLs locales necesarias.

En Windows PowerShell, desde la raíz del repositorio:

```powershell
.\scripts\docker-up.ps1
```

En Linux/macOS:

```bash
bash scripts/docker-up.sh
```

La API inicia primero. Después, `storage-bootstrap` prepara el bucket y termina con código `0`; el worker espera a que ese paso finalice correctamente. También puedes iniciar manualmente con `docker compose up -d --build`, pero ese comando no imprime el resumen de URLs.

Comprueba los servicios y sus registros:

```powershell
docker compose ps
docker compose logs --tail=100 savecloud-api create-bucket steam-seed-worker
```

`savecloud-api` debe aparecer `Healthy`, `steam-seed-worker` debe seguir `Up` y `savecloud-storage-bootstrap` puede aparecer como `Exited (0)`, porque es una tarea de inicialización.

Endpoints locales:

- API: `http://localhost:3000`
- Salud de la API: `http://localhost:3000/health`
- WebSocket local: `ws://localhost:3000/ws` (sin TLS)
- Consola de AIStor: `http://localhost:9001`
- Endpoint S3 de AIStor: `http://localhost:9000`
- DynamoDB Local: `http://localhost:8000` (solo para servicios locales)

En una instalación local sin TLS, el protocolo WebSocket es `ws://`. Usa `wss://` si expones la API por un dominio configurado con TLS. Desde otro equipo de la red, reemplaza `localhost` por la IP o el dominio del servidor.

La consola usa las credenciales configuradas en `OBJECT_STORAGE_ACCESS_KEY` y `OBJECT_STORAGE_SECRET_KEY`. Si no las defines, Compose usa `minioadmin` para ambas; son valores predeterminados de desarrollo y conviene cambiarlos.

En la aplicación de escritorio, ve a **Configuración → Conexión de servidor** y configura `http://localhost:3000` (o la IP del servidor) junto con el valor de `SYNC_GAMES_API_KEY`.

## Almacenamiento de los datos

Compose mantiene los objetos de AIStor y las tablas de DynamoDB en los volúmenes `minio_data` y `dynamodb_data`.

`docker compose down` detiene y elimina los contenedores, pero conserva los volúmenes. Para borrar también los datos locales de SaveCloud y empezar desde cero:

```powershell
docker compose down --volumes --remove-orphans
docker compose up -d --build
```

Elimina de forma permanente los objetos locales de MinIO y las tablas de DynamoDB. No uses `--volumes` si necesitas conservarlos.

## Comandos útiles

```powershell
# Ver los registros de todos los servicios
docker compose logs -f

# Detener los servicios y conservar los datos
docker compose down

# Iniciar, esperar a que esté listo e imprimir las URLs (Windows)
.\scripts\docker-up.ps1

# Iniciar, esperar a que esté listo e imprimir las URLs (Linux/macOS)
bash scripts/docker-up.sh
```
