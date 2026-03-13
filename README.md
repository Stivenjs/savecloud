# SaveCloud

![Bun](https://img.shields.io/badge/runtime-bun-black)
![Node](https://img.shields.io/badge/node-20-green)
![TypeScript](https://img.shields.io/badge/language-typescript-blue)
![Fastify](https://img.shields.io/badge/api-fastify-black)
![AWS](https://img.shields.io/badge/deploy-AWS-orange)
![S3](https://img.shields.io/badge/storage-S3-red)
![Tauri](https://img.shields.io/badge/desktop-tauri-blue)
![React](https://img.shields.io/badge/frontend-react-61dafb)
![Rust](https://img.shields.io/badge/backend-rust-orange)

Servidor de guardado en la nube para juegos (S3 + Lambda) y app de escritorio para sincronizar guardados. Clean Architecture en backend y CLI.

## Guía de despliegue

La infraestructura backend y la configuración completa del proyecto se explican en la guía de despliegue disponible en:

[Guía de despliegue](./doc/DEPLOYMENT.md)

Esta guía cubre la preparación del entorno, generación de API keys, configuración del archivo `.env`, despliegue en AWS (dev y live), configuración de la aplicación de escritorio y verificación del sistema.

## Contenido del repositorio

- **Backend (API + CLI):** raíz del repo — Fastify, TypeScript, despliegue en AWS Lambda + API Gateway, almacenamiento en S3.
- **App de escritorio:** `apps/sync-games-desktop` — Tauri 2 (React + Vite + Rust), interfaz gráfica para gestionar juegos, subir/descargar guardados, amigos y configuración.

## Stack del backend

- **Runtime:** Bun (local) / Node.js 20 (Lambda)
- **Lenguaje:** TypeScript
- **API:** Fastify
- **Deploy:** Serverless Framework → AWS Lambda + API Gateway
- **Almacenamiento:** AWS S3

## Stack de la app de escritorio

- **Frontend:** React 19, Vite, HeroUI, TanStack Query, Framer Motion
- **Backend local:** Tauri 2 (Rust) — comandos para config, sincronización, Steam, etc.
- **Plugins Tauri:** dialog, autostart, notification, updater, opener

## Estructura del backend (Clean Architecture)

```
src/
├── domain/                 # Entidades y reglas de negocio
│   ├── entities/
│   └── ports/
├── application/            # Casos de uso (orquestación)
│   └── use-cases/
├── infrastructure/         # Implementaciones concretas (S3, etc.)
│   └── persistence/
└── interfaces/             # Entrada/salida (HTTP, Lambda)
    ├── http/               # Fastify app, rutas
    └── lambda/             # Handler para AWS Lambda
```

Las dependencias apuntan hacia dentro: `interfaces` → `application` → `domain`; `infrastructure` implementa los puertos definidos en `domain`.

## Scripts (raíz del repo)

| Script                           | Descripción                                         |
| -------------------------------- | --------------------------------------------------- |
| `bun run build`                  | Compila TypeScript del backend                      |
| `bun run dev`                    | API en local con hot-reload (puerto 3000)           |
| `bun run deploy:dev`             | Despliega a AWS (stage `dev`)                       |
| `bun run deploy:live`            | Despliega a AWS (stage `live`)                      |
| `bun run invoke:local`           | Invoca la función Lambda en local                   |
| `bun run cli`                    | Ejecuta el CLI (menú interactivo)                   |
| `bun run cli -- add <id> <ruta>` | Añade un juego desde la CLI                         |
| `bun run build:cli`              | Genera ejecutable en `dist/` (ej. `savecloud.exe`)  |
| `bun run desktop`                | App de escritorio en modo desarrollo (Tauri + Vite) |
| `bun run desktop:dev`            | Solo frontend (Vite)                                |
| `bun run desktop:build`          | Build de instalador de la app de escritorio         |
| `bun run api-key`                | Genera API key para el backend                      |
| `bun run api-key:live`           | Genera API key para el backend (live)               |
| `bun run desktop:latest-json`    | Genera latest.json para la app de escritorio        |
| `bun run desktop:icon`           | Genera icono para la app de escritorio              |

Instalación: `bun install` en la raíz.

## Cómo ejecutar el CLI

- **Menú interactivo:** `bun run cli` (o `savecloud` si hiciste `bun link`) → menú para añadir juego, listar, subir/descargar, config, etc.
- **Modo comando:** `bun run cli -- add elden-ring "%APPDATA%/EldenRing"` o `bun run cli -- upload`

Config por defecto: `%APPDATA%/savecloud/config.json` (Windows) o `~/.config/savecloud/config.json` (Linux/macOS).

## App de escritorio

Desde la raíz: `bun run desktop`. Requiere Rust y dependencias de Tauri instaladas.

- **Juegos:** listado, añadir/editar/eliminar, subir a la nube, descargar, “Subir todos” / “Descargar todos” (con operaciones batch y paralelismo). Archivos ≥ 5 MB se suben por **multipart** (pausar, cancelar, reanudar); archivos pequeños en **lotes de hasta 16 PUTs en paralelo** y hasta 500 URLs por petición a la API. El tamaño en la nube se muestra correctamente en GB/TB. Al eliminar un juego se borra también de la nube (S3). Al editar se puede cambiar el nombre/ID del juego; se actualiza en la app, en el config y en S3 (los guardados se migran al nuevo nombre).
- **Diagnóstico:** en caso de errores de subida, se escribe un log en el directorio de configuración (`sync-debug.log`); el comando `get_sync_debug_log_path` devuelve su ruta para poder abrirlo.
- **Amigos:** importar por link compartido, ver perfil por User ID, copiar guardados de un amigo.
- **Configuración:** API URL, User ID, API Key, autostart, notificaciones, respaldo/restauración del config en la nube (con subida automática tras cambios). Gestión de backups locales: elegir cuántos backups mantener por juego (3, 5, 10 o 20) y liberar espacio; la preferencia se guarda en config y se aplica también a la auto-limpieza tras cada descarga.
- **Historial:** operaciones de sync recientes.

## Variables de entorno (backend / Lambda)

- `BUCKET_NAME` — Nombre del bucket S3 (Serverless lo inyecta en Lambda).
- `API_KEY` — (opcional) Si está definido, la API exige header `x-api-key`.
- Desarrollo local: `BUCKET_NAME`, `AWS_REGION`, `PORT` (opcional).

## API

| Método y ruta                               | Descripción                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /health`                               | Health check                                                                   |
| `GET /saves`                                | Lista guardados del usuario (headers: `x-user-id`, `x-api-key` si aplica)      |
| `POST /saves/upload-url`                    | Una URL de subida. Body: `{ "gameId", "filename" }` → `{ "uploadUrl", "key" }` |
| `POST /saves/upload-urls`                   | Batch: varias URLs de subida (máx. 500 ítems por petición).                    |
| `POST /saves/download-url`                  | Una URL de descarga. Body: `{ "gameId", "key" }`                               |
| `POST /saves/download-urls`                 | Batch: varias URLs de descarga.                                                |
| `POST /saves/multipart/init`                | Inicia subida multipart (archivos grandes).                                    |
| `POST /saves/multipart/init-with-part-urls` | Init + todas las URLs de partes en una llamada.                                |
| `POST /saves/multipart/part-urls`           | URLs firmadas para partes.                                                     |
| `POST /saves/multipart/complete`            | Completa subida multipart.                                                     |
| `POST /saves/multipart/abort`               | Aborta subida multipart.                                                       |
| `POST /saves/delete-game`                   | Borra todos los guardados del juego en S3.                                     |
| `POST /saves/rename-game`                   | Renombra un juego en S3 (copia a nuevo prefijo y borra el antiguo).            |

El cliente sube y descarga archivos directamente desde S3 utilizando URLs firmadas. La app de escritorio usa endpoints batch y multipart para reducir llamadas a la API.

## Probar que los guardados se suben a S3

1. **API en local**

```bash
export BUCKET_NAME=tu-bucket-savecloud
export AWS_REGION=us-east-2
bun run dev
```

La API quedará disponible en `http://localhost:3000`.

2. **Configurar el CLI o la app de escritorio** con la URL de la API y un `userId` en el archivo de configuración.

3. **Subir guardados**

```
bun run cli -- upload <game-id>
```

También puede hacerse desde la app de escritorio.

Luego verifica en S3 la ruta:

```
userId/gameId/<archivo>
```

Si desplegaste en AWS (`bun run deploy:dev`), usa en la configuración la URL del API Gateway (por ejemplo `https://xxxx.execute-api.us-east-2.amazonaws.com`).

## Arquitectura del sistema

```
Desktop App (Tauri + React)
          │
          │ HTTPS
          ▼
      API Gateway
          │
          ▼
      AWS Lambda
          │
          ▼
        Amazon S3
          │
          ▼
     CloudFront (solo en live)
```

La aplicación de escritorio solicita **URLs firmadas** al backend. Luego sube y descarga archivos **directamente desde S3**, evitando que Lambda procese los archivos y reduciendo costos y latencia.

## Comandos rápidos

Comandos más comunes durante desarrollo:

```bash
# instalar dependencias
bun install

# ejecutar API local
bun run dev

# desplegar entorno de desarrollo
bun run deploy:dev

# desplegar entorno de producción
bun run deploy:live

# ejecutar app de escritorio
bun run desktop
```

## Troubleshooting

### Error de autenticación en la API

Verifica que el header `x-api-key` coincida con la variable `API_KEY` configurada en el backend.

### Archivos no aparecen en S3

Comprueba:

- que `BUCKET_NAME` esté configurado correctamente
- que el usuario tenga permisos `s3:PutObject`
- que el `userId` usado por el cliente sea correcto

### Fallos en subida multipart

Si una subida grande falla:

- revisa el archivo `sync-debug.log`
- cancela la subida en la app
- vuelve a iniciar el proceso

### Problemas con CloudFront

Si los archivos no se descargan correctamente en `live`:

- espera unos minutos a que la distribución se propague
- invalida la cache de CloudFront si cambiaste objetos existentes

---

## Licencia

Este proyecto está licenciado bajo.[**MIT**](./LICENSE)
