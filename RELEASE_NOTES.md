# Notas de versión

## v1.4.0 (actual)

### API (backend)

- **CloudFront para descargas más rápidas (solo producción):**
  - Nueva distribución CloudFront delante del bucket S3 de guardados, con TTL de cache de 1 año.
  - Solo se crea en el stage `live`; en `dev` todo sigue usando S3 directo.
- **Backups servidos vía CloudFront, saves rápidos vía S3:**
  - Las URLs de descarga de backups (`userId/gameId/backups/...`) ahora usan el dominio de CloudFront cuando está configurado.
  - Los guardados “rápidos” de cada partida se siguen sirviendo con URLs presignadas de S3 para evitar costes extra y problemas de cache.
- **Nueva variable de entorno `DOWNLOAD_BASE_URL`:**
  - En `live` apunta al dominio de CloudFront y la API la usa para construir las URLs de descarga de backups.
  - En `dev` queda vacía y la API hace fallback automático a URLs presignadas como antes.
- **Infra por stage más limpia:**
  - Los recursos de CloudFormation se movieron a `resources.dev.yml` y `resources.live.yml`, cargados desde `serverless.yml` con `${file(./resources.${sls:stage}.yml)}`.
  - CloudFront y su OAI/policy solo existen en `resources.live.yml`, evitando errores de plantilla y simplificando la diferencia entre entornos.

### App de escritorio (Tauri)

- **Sin cambios funcionales requeridos:**
  - La app sigue usando los mismos endpoints (`/saves/download-url`, `/saves/download-urls`, etc.).
  - Para backups, la URL que devuelve la API puede ser de CloudFront en producción, pero la app no necesita adaptaciones.

### Correcciones / refactors

- Se corrigieron problemas de plantilla en `serverless.yml` (errores de YAML y uso incorrecto de `Condition`) siguiendo la documentación oficial de Serverless Framework v4.

