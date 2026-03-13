# Guía de Despliegue: SaveCloud

Esta guía detalla el proceso para desplegar la infraestructura backend de **SaveCloud** en AWS (**Lambda, API Gateway, S3, CloudFront**) mediante **Serverless Framework**, y explica cómo configurar la aplicación de escritorio.

---

# Prerrequisitos

Antes de iniciar, tu entorno local debe contar con:

1. **Bun** o **Node.js 22.x**
2. **AWS CLI** configurado (`aws configure`) con credenciales que tengan permisos para crear recursos **IAM, S3, Lambda, API Gateway y CloudFront**
3. **Serverless Framework** (versión 4)
4. **Rust y Cargo** _(solo requerido si planeas modificar el código fuente de la aplicación de escritorio)_

---

# Fase 1: Preparación y Variables de Entorno

## 1. Instalar dependencias

En la raíz del repositorio, instala los paquetes necesarios:

```bash
bun install
```

---

## 2. Generar las API Keys

La API utiliza un autorizador Lambda (`apiAuthorizer`) que exige un header `x-api-key`.
Genera estas claves antes de desplegar:

### Para el entorno de desarrollo (`dev`)

```bash
bun run api-key
```

### Para el entorno de producción (`live`)

```bash
bun run api-key:live
```

Guarda los valores generados.

---

## 3. Configurar el archivo `.env`

Crea un archivo `.env` en la raíz con las siguientes variables:

```env
# Clave generada en el paso anterior
SYNC_GAMES_API_KEY=sg_test_...

# Configuración de AWS
AWS_REGION=us-east-2

# Configuración de S3 Transfer Acceleration
USE_ACCELERATE_ENDPOINT=false

# Puerto para desarrollo local
PORT=3000
```

### Sobre la variable `USE_ACCELERATE_ENDPOINT`

Esta variable activa **S3 Transfer Acceleration**, lo que permite subidas y descargas más rápidas enrutando el tráfico a través de los **Edge Locations de CloudFront** en lugar de ir directamente al bucket S3.

**Importante**

Si decides cambiar esto a `true` y habilitarlo en tu bucket AWS:

- El cambio puede tardar aproximadamente **20 minutos** en propagarse.
- **AWS cobra tarifas adicionales** por la transferencia acelerada.
- Revisa los **precios de S3 Transfer Acceleration** antes de activarlo.

---

# Fase 2: Arquitectura y Despliegue en AWS

El proyecto maneja **dos entornos separados**:

- `dev`
- `live`

Cada uno tiene su propio **stack de recursos**.

---

# Entorno de Desarrollo (`dev`)

El despliegue en `dev` aprovisiona:

- **API Gateway**
- **AWS Lambda**
- **Bucket S3**
- Encriptación **AES256**
- Reglas **CORS**

Este entorno es ideal para **pruebas rápidas**.

### Desplegar

```bash
bun run deploy:dev
```

---

# Entorno de Producción (`live`)

El despliegue en `live` incluye todos los recursos de `dev`, pero añade una capa de **CDN** para optimizar las descargas.

Componentes adicionales:

### CloudFront Distribution

- Cachea y sirve los archivos estáticos
- Utiliza **HTTP/2**
- Redirección automática a **HTTPS**

### CloudFront Origin Access Identity (OAI)

Asegura que el **bucket S3 solo sea accesible desde CloudFront** y no directamente desde internet mediante políticas de bucket (`SavesBucketPolicy`).

### URL de descarga base

El backend detecta automáticamente el entorno.

En `live`, utilizará automáticamente el **dominio de CloudFront** para generar las URLs de descarga.

### Desplegar

```bash
bun run deploy:live
```

---

### Endpoint del API

Al finalizar cualquier despliegue, **Serverless Framework imprimirá en consola un endpoint de API Gateway**.

Copia esta URL, ya que será tu:

`API URL`

para la aplicación cliente.

---

# Fase 3: Uso de la Aplicación de Escritorio

**Aclaración importante**

No es necesario compilar la aplicación de escritorio a menos que:

- vayas a **modificar el código fuente**
- o **agregar nuevas funcionalidades**

Para uso normal, **el ejecutable ya está empaquetado**.

---

# Instrucciones para usuarios

1. Ve a la sección **Releases** del repositorio.
2. Descarga la última versión compilada (`.exe` o `.msi`).
3. Instala y abre la aplicación.

En la interfaz de configuración inicial introduce:

- **API URL** → La URL del API Gateway obtenida tras el despliegue.
- **API Key** → El valor de `SYNC_GAMES_API_KEY`.
- **User ID** → Tu identificador único.

---

# Instrucciones para desarrolladores (Opcional)

Si modificaste:

- la interfaz en **React/Vite**
- los comandos de **Tauri en Rust**

Deberás recompilar la aplicación:

```bash
bun run desktop:icon
bun run desktop:latest-json
bun run desktop:build
```

El instalador generado se ubicará en:

```
apps/sync-games-desktop/src-tauri/target/release/bundle/
```

---

# Fase 4: Verificación

Para validar que la infraestructura funciona correctamente:

1. Añade un juego en la aplicación de escritorio indicando la **ruta local de sus partidas guardadas**.
2. Inicia una **subida a la nube**.
3. Ve a la **consola de AWS S3** y verifica que los archivos existan bajo el prefijo:

```
userId/gameId/
```

4. Intenta **descargar el archivo desde la aplicación**.

Si desplegaste en `live`, la descarga debería realizarse a través de la **URL de CloudFront**.
