# Notas de versión

## 1.8.5

### API (backend)

- **CloudFront para descargas de backups (solo producción):**
  - Distribución CloudFront delante del bucket S3 con TTL de cache de 1 año.
  - Solo se crea en el stage `live`; en `dev` todo sigue usando S3 directo.
  - Las URLs de descarga de backups (`userId/gameId/backups/...`) usan CloudFront cuando está configurado; los saves “rápidos” siguen con URL presignada de S3.

- **Infra por stage organizada:**
  - Recursos de CloudFormation movidos a `resources.dev.yml` y `resources.live.yml`, cargados desde `serverless.yml` con `${file(./resources.${sls:stage}.yml)}`.
  - CloudFront y su OAI/policy solo existen en `resources.live.yml`.

- **Rutas de guardados de Steam y cracks:**
  - Se añadieron las rutas de guardados de Steam y cracks para el manifiesto de Ludusavi.
  - Se añadieron las rutas de guardados de Steam y cracks para el escaneo de guardados.

### App de escritorio (Tauri)

- **Backup completo en streaming (sin .tar temporal):**
  - Nuevo modo de “Empaquetar y subir” que genera el `.tar` en streaming y lo sube por multipart sin escribirlo a disco (partes de 32 MiB).
  - Reduce uso de disco y acelera backups de juegos grandes.

- **Modo prueba de streaming (sin subir a la nube):**
  - Flag experimental para ejecutar el backup completo en streaming, medir tiempos y ver la UI sin crear objetos en S3.
  - El flujo se loguea en `sync-debug.log` con bytes totales procesados.

- **Mejor cálculo de tamaño de juego:**
  - `get_game_stats` ahora calcula el tamaño de cada juego en hilos bloqueantes en paralelo (`spawn_blocking`), evitando bloquear el runtime async.

- **Gestión de backups locales mejorada:**
  - Selector de “mantener últimos N backups” por juego y botón para limpiar backups antiguos.
  - Nuevo botón para borrar **todos** los backups locales (`savecloud/backups`) con confirmación explícita.

- **UI de progreso más limpia:**
  - Para operaciones sin porcentaje conocido (empaquetado, streaming), se muestra un spinner de HeroUI con mensaje en lugar de una barra indeterminada en movimiento.

### Correcciones / refactors

- Se corrigieron problemas de plantilla en `serverless.yml` (errores de YAML y uso incorrecto de `Condition`) siguiendo la documentación oficial de Serverless Framework v4.
- Se refactorizó el cálculo de estadísticas y el flujo de backup completo para mejorar rendimiento y evitar bloqueos de la UI.

---

## 1.8.5 (actual)

### App de escritorio (Tauri)

- **Menos peticiones al cargar la lista de juegos:**
  - Medios de Steam (portada, capturas, vídeo) se piden en una sola invocación `get_steam_appdetails_media_batch`; el backend hace las peticiones HTTP en paralelo. GamesList y FriendGamesSection usan este batch; las tarjetas ya no disparan una petición por juego.
  - Conteo de backups completos en la nube: una sola llamada `list_full_backups_batch` en lugar de una por juego (`useCloudBackupCounts`).

- **Modal de vídeo:** tamaño más grande (92vh), sin botón de silenciar en el modal; el reproductor usa sus controles nativos (volumen, etc.).

- **Barra de búsqueda de juegos:** debounce de 300 ms para no filtrar en cada tecla; la lista y el mensaje de “sin resultados” usan el término debounced.

- **Caché de configuración:** `useConfig` con `staleTime` de 2 minutos. Se invalida la query `["config"]` al añadir, editar o eliminar juego, al refrescar y en los flujos de amigos y ajustes, para que la UI vea siempre la config actualizada.

### UI y animaciones

- **Tarjetas de juego (hover):** animación 3D que sigue el cursor (tilt suave), elevación y sombra al pasar el ratón; archivo `GameCardHoverMotion.tsx`. Corregido el bug de animación infinita usando un rect fijo al entrar.

- **Lista de juegos:** animación de aparición en escalonado (stagger) al cargar o al cambiar filtros/búsqueda; archivo `GamesListMotion.tsx`. Activación retrasada un frame para que la animación se vea correctamente.

### Próxima versión

- Se intentara mejorar el rendimiento de la app de escritorio al hacer menos peticiones a la api.
- Se intentara mejorar la concurrencia en el streaming de backups.
