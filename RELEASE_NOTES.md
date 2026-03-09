# Notas de versión

## v1.5.0 (actual)

### API (backend)

- **CloudFront para descargas de backups (solo producción):**
  - Distribución CloudFront delante del bucket S3 con TTL de cache de 1 año.
  - Solo se crea en el stage `live`; en `dev` todo sigue usando S3 directo.
  - Las URLs de descarga de backups (`userId/gameId/backups/...`) usan CloudFront cuando está configurado; los saves “rápidos” siguen con URL presignada de S3.
- **Infra por stage organizada:**
  - Recursos de CloudFormation movidos a `resources.dev.yml` y `resources.live.yml`, cargados desde `serverless.yml` con `${file(./resources.${sls:stage}.yml)}`.
  - CloudFront y su OAI/policy solo existen en `resources.live.yml`.

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
  - Nuevo botón para borrar **todos** los backups locales (`sync-games/backups`) con confirmación explícita.
- **UI de progreso más limpia:**
  - Para operaciones sin porcentaje conocido (empaquetado, streaming), se muestra un spinner de HeroUI con mensaje en lugar de una barra indeterminada en movimiento.

### Correcciones / refactors

- Se corrigieron problemas de plantilla en `serverless.yml` (errores de YAML y uso incorrecto de `Condition`) siguiendo la documentación oficial de Serverless Framework v4.
- Se refactorizó el cálculo de estadísticas y el flujo de backup completo para mejorar rendimiento y evitar bloqueos de la UI.

