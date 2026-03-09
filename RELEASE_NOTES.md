# Notas de versión

## v1.3.1 (actual)

### API (backend)

- **Subida multipart (archivos grandes):** endpoints `POST /saves/multipart/init`, `POST /saves/multipart/part-urls`, `POST /saves/multipart/complete`, `POST /saves/multipart/abort` para subidas por partes (S3 multipart). Soporta pausar, cancelar y reanudar desde el cliente.
- **Init con todas las URLs en una llamada:** `POST /saves/multipart/init-with-part-urls` — devuelve `uploadId`, `key` y todas las URLs de partes (hasta 2000) en una sola invocación Lambda, reduciendo invocaciones por archivo grande a 2 (init+complete).
- **Límite en upload-urls:** máximo 500 ítems por petición en `POST /saves/upload-urls` para evitar timeouts en Lambda; el cliente solicita por lotes.
- **Listado S3 con paginación:** `GET /saves` (listByUser) ahora pagina correctamente en S3; antes solo devolvía los primeros 1000 objetos, por lo que con muchos archivos se mostraba un solo juego o totales incorrectos al superar 1 GB.
- **Validación de clave S3:** longitud máxima 1024 bytes y rechazo de `filename` con byte nulo; mensajes de error claros en respuestas 500.
- **Descripción de Lambdas:** las funciones `api` y `apiAuthorizer` tienen descripción en `serverless.yml` que incluye el stage (dev/live) para identificarlas en la consola AWS.

### App de escritorio (Tauri)

- **Archivos grandes (≥ 5 MB):** subida multipart con partes de 10 MB; pausar, cancelar y reanudar (estado guardado en `paused_upload.json`); botones Pausar/Reanudar/Cancelar en la barra de progreso.
- **Menos invocaciones Lambda:** uso de `init-with-part-urls` cuando el archivo tiene ≤ 2000 partes; lotes de 100 partes en `part-urls` para fallback y reanudar; lotes de 500 en `upload-urls` para archivos pequeños.
- **Subida mucho más rápida:**
  - **PUTs simples en paralelo:** hasta 16 archivos pequeños se suben a la vez (antes en serie); miles de archivos pasan de ~17 min a ~25 s.
  - **Partes multipart en paralelo:** hasta 4 partes del mismo archivo grande se suben a la vez.
- **Log de diagnóstico:** se escribe `sync-debug.log` en el directorio de configuración; comando `get_sync_debug_log_path` para abrirlo; trazas por operación (multipart start, API errors, progreso de PUTs) para depurar errores 500 o bloqueos.
- **Tamaño en la nube (GB/TB):** corrección del formateo de bytes en el cliente: ya no se mostraba mal al superar 1 GB (índice de unidad por `Math.log`); ahora se usa cálculo por umbrales y se soporta TB.

### Correcciones

- Al superar 1 GB en la nube, la app dejaba de mostrar todos los juegos y el total correcto: corregido con paginación en S3 en el backend.
- Error 500 al subir miles de archivos pequeños en una sola petición: corregido con límite de 500 ítems en la API y petición por lotes en el cliente.
- Tamaño mostrado como “1024 MB” o incorrecto al pasar 1 GB: corregido en `formatSize` (utils/format.ts).

---

## v1.2.1

### API (backend)

- **Endpoints batch:** `POST /saves/upload-urls` y `POST /saves/download-urls` para obtener varias URLs firmadas en una sola petición, reduciendo invocaciones Lambda y latencia.
- **Eliminar juego en la nube:** `POST /saves/delete-game` — borra todos los objetos S3 bajo `userId/gameId/`.
- **Renombrar juego en la nube:** `POST /saves/rename-game` — copia los guardados al nuevo prefijo y borra el antiguo (migración en S3).
- Mantenidos los endpoints unitarios `upload-url` y `download-url` por compatibilidad.
- **IAM:** el Lambda incluye `s3:DeleteObject` además de GetObject/PutObject/ListBucket para que delete y rename funcionen.

### App de escritorio (Tauri)

- **Subida/descarga más rápidas:** uso de los endpoints batch de la API (una llamada por juego con todos sus archivos) en lugar de una por archivo.
- **“Subir todos” / “Descargar todos” en paralelo:** hasta 4 juegos se procesan a la vez (batch de juegos en Rust).
- **Eliminar juego:** al confirmar eliminación se borra el juego de la config y sus guardados en la nube (llamada a delete-game). Si falla el borrado en la nube se muestra un aviso pero el juego se quita igual de la app.
- **Editar nombre/ID del juego:** el modal de edición permite cambiar el identificador del juego; se actualiza en la app, en el config y en S3 (rename-game en la API + `rename_game` en config local).
- **Config en la nube:** subida automática del `config.json` tras cambios (debounce 2,5 s) y respaldo periódico cada 5 minutos.
- **Conflictos de descarga en batch:** un solo chequeo de conflictos para todos los juegos antes de “Descargar todos” (`sync_check_download_conflicts_batch`).
- **Steam App ID en batch:** una llamada para resolver varios nombres de juego a Steam App ID.
- **Limpieza de backups locales:** antes de descargar desde la nube se crea una copia local en `sync-games/backups/[juego]/[fecha]`. Para no acumular infinitos backups: (1) tras cada descarga se eliminan los backups antiguos dejando solo los últimos N por juego; (2) en Configuración → “Respaldo local automático” se puede elegir cuántos mantener (3, 5, 10 o 20) y ejecutar “Liberar espacio ahora”. La preferencia se guarda en `config.json` (`keepBackupsPerGame`) y se usa también para la auto-limpieza.
- **UI:** transiciones entre pestañas (framer-motion), mejor organización de páginas (Juegos, Amigos, Configuración), modales de confirmación al importar por link y al copiar guardados de un amigo, botón Actualizar con estado de carga.
- **Estado:** menos `useState` dispersos; uso de `useReducer` en páginas principales (juegos, amigos, configuración).

### Correcciones

- Modal de plantilla (“Usar config como plantilla”) ya no mostraba “No hay juego seleccionado” al elegir un juego de amigo.
- Un solo indicador de carga en el botón Actualizar (sin Spinner duplicado).
- Renombrar en S3: `CopySource` en S3 usa `encodeURIComponent` para keys con caracteres especiales.

---

## Versiones anteriores

- **v0.1.x:** API inicial (upload-url, download-url, list saves), CLI con menú y comandos, app de escritorio Tauri con listado de juegos, sync por juego, amigos (link compartido, User ID), configuración y respaldo del config en la nube.
