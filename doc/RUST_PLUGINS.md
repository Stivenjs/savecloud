# Sistema de plugins -- Referencia para desarrolladores Rust

Este documento explica la arquitectura del sistema de plugins de SaveCloud, cómo extenderlo, y las responsabilidades de cada módulo en la capa Rust.

---

## Descripción general

El sistema de plugins permite que scripts Lua externos se enganchen al ciclo de vida de SaveCloud sin modificar el código Rust. Cada plugin corre dentro de su propia VM `mlua::Lua` aislada. La capa Rust es responsable de:

- Escanear el directorio de plugins y cargar cada plugin en un hilo separado para no bloquear la app.
- Exponer una API controlada a Lua (la tabla global `savecloud`).
- Mantener un buffer de logs en memoria que recibe entradas desde los plugins en tiempo real.
- Orquestar hooks de ciclo de vida (`on_init`, `on_game_start`, `on_game_exit`, `on_save_detected`).
- Ejecutar el pipeline de subida (`on_pre_upload`, `on_post_upload`).
- Proporcionar persistencia SQLite aislada por plugin en `plugin_storage`.

---

## Contrato de carga y Manifiesto

La carga es estricta y requiere un manifest `plugin.json` en la raíz de cada plugin.

### plugin.json mínimo

```json
{
  "id": "mi.plugin",
  "name": "Mi Plugin",
  "version": "1.0.0",
  "api_version": 1,
  "enabled": true,
  "hooks": {
    "on_pre_upload_timeout_ms": 2000
  }
}
```

### Reglas de carga

- Si falta `plugin.json`, el plugin se omite (`manifest_missing`).
- Si `plugin.json` es inválido, el plugin se omite (`manifest_invalid`).
- Si `enabled` es `false`, el plugin no se carga (`plugin_disabled`).
- Si `api_version` no coincide con la versión soportada por el core (`1`), el plugin no se carga (`api_version_mismatch`).

---

## Estructura de módulos

```
src/plugins/
  mod.rs        -- Declaraciones públicas de módulos y alias de tipo compartido (AppPluginManager)
  manifest.rs   -- Parseo, validación y sanitizado de plugin.json
  api.rs        -- Registra la API Lua (savecloud.log, ui, db, http, storage, notifications, games)
  plugin.rs     -- Representa y gestiona una instancia individual de plugin y sus llamadas a hooks
  manager.rs    -- Descubre, carga y orquesta todos los plugins
  log_buffer.rs -- Buffer en memoria de logs emitidos por plugins
  plugin_sdk.rs -- Comando Tauri para exportar el archivo de definiciones savecloud-api.lua
```

---

## Módulos de la API Lua (`api.rs`)

`register_savecloud_api` construye la tabla Lua `savecloud` e inyecta los siguientes submódulos:

| Módulo                    | Implementación Rust             | Descripción                                                                    |
| :------------------------ | :------------------------------ | :----------------------------------------------------------------------------- |
| `savecloud.log`           | `register_log_module`           | Traza hacia buffer de logs (`info`, `warn`, `error`, `debug`)                  |
| `savecloud.ui`            | `register_ui_module`            | Emisión IPC (`emit`) y notificaciones flotantes (`show_toast`)                 |
| `savecloud.db`            | `register_db_module`            | Registro de operaciones de auditoría (`log_operation`)                         |
| `savecloud.http`          | `register_http_module`          | Cliente HTTP síncrono (`get`, `post`, `put`, `delete`)                         |
| `savecloud.storage`       | `register_storage_module`       | Almacenamiento clave-valor en tabla SQLite `plugin_storage` aislado por plugin |
| `savecloud.notifications` | `register_notifications_module` | Notificaciones del sistema y Overlay In-Game (`show`, `show_overlay`)          |
| `savecloud.games`         | `register_games_module`         | Lectura de biblioteca configurada y comprobación de procesos activos           |

---

## Orquestación de Hooks (`plugin.rs` y `manager.rs`)

### Hooks de Ciclo de Vida

1. **`on_game_start(game)`**:
   Llamado desde `process_check.rs` cuando un ejecutable de juego arranca:

   ```rust
   pm.lock().await.execute_game_start(game_id, game_name);
   ```

2. **`on_game_exit(game, session)`**:
   Llamado desde `process_check.rs` cuando el proceso del juego finaliza:

   ```rust
   pm.lock().await.execute_game_exit(game_id, game_name, duration_secs);
   ```

3. **`on_save_detected(game, save_path)`**:
   Llamado desde `watch_sync.rs` cuando el observador del sistema de archivos detecta cambios en las rutas de guardado:

   ```rust
   pm.lock().await.execute_save_detected(game_id, save_path);
   ```

4. **`on_pre_upload(data, context)`**:
   Llamado en cadena en `upload.rs` antes de subir el archivo a S3/nube:

   ```rust
   body = pm.execute_pre_upload(body, game_id, relative_path);
   ```

5. **`on_post_upload(summary)`**:
   Llamado en `upload.rs` al completar la subida de un juego:
   ```rust
   pm.execute_post_upload(game_id, success, ok_count, err_count);
   ```

---

## Persistencia SQLite (`plugin_storage`)

La migración `021_plugin_storage.sql` define la tabla:

```sql
CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (plugin_id, key)
);
```

Todas las operaciones de `savecloud.storage` (`get`, `set`, `delete`, `list_keys`, `clear`) están automáticamente confinadas al `plugin_id` del plugin que realiza la llamada, garantizando aislamiento total entre plugins.
