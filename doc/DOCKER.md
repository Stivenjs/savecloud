# Guía de Autohospedaje (Self-Hosting) con Docker

Esta guía explica cómo desplegar el backend completo de **SaveCloud** en tu propio servidor local, NAS (CasaOS, Unraid, Synology, Portainer) o VPS usando **Docker Compose** en 2 minutos.

---

## Componentes incluidos en la pila Docker

- **SaveCloud API (Fastify)**: Escuchando en el puerto `3000`.
- **MinIO (S3 Local)**: Servidor S3 autónomo para almacenar archivos de guardado.
- **DynamoDB Local**: Base de datos de alta velocidad para índices y estadísticas de juegos.

---

## Requisitos previos

- **Docker** y **Docker Compose** instalados en tu sistema.

---

## Pasos para desplegar

### 1. Clonar el repositorio o descargar los archivos

Descarga el archivo `docker-compose.yml` e inicio de entorno en una carpeta de tu servidor.

### 2. (Opcional) Configurar tu API Key personalizada

Por defecto, la API Key es `sg_secret_key_12345`. Puedes cambiarla en el archivo `docker-compose.yml` o en un archivo `.env`:

```env
SYNC_GAMES_API_KEY=tu_clave_personalizada_aqui
```

### 3. Iniciar la pila con Docker Compose

Ejecuta el siguiente comando en la terminal:

```bash
docker compose up -d
```

### 4. Verificar la instalación

- **API backend**: Visita `http://IP_DE_TU_SERVIDOR:3000/health` (debe responder `200 OK`).
- **Panel de MinIO (Opcional)**: Visita `http://IP_DE_TU_SERVIDOR:9001` (Usuario: `minioadmin`, Clave: `minioadmin`).

---

## Configurar la App de Escritorio SaveCloud

1. Abre la aplicación de escritorio **SaveCloud**.
2. Ve a **Configuración** -> **Conexión de Servidor**.
3. Ingresa los siguientes datos:
   - **URL del servidor**: `http://IP_DE_TU_SERVIDOR:3000` (o `http://localhost:3000` si juegas en la misma PC).
   - **API Key**: `sg_secret_key_12345` (o tu clave personalizada).
4. ¡Haz clic en **Guardar y Probar Conexión**!

---

## Comandos útiles

```bash
# Ver los logs del servidor
docker compose logs -f savecloud-api

# Detener los servicios
docker compose down

# Actualizar el contenedor a la última versión
docker compose pull && docker compose up -d
```
