# Guía de desarrollo de plugins para SaveCloud

Esta guía explica cómo escribir plugins para SaveCloud. Los plugins se escriben en **Lua** y no requieren ningún conocimiento de Rust.

---

## Cómo funcionan los plugins

SaveCloud escanea la carpeta `plugins/` de la aplicación al iniciar. Cada subcarpeta dentro de ella es tratada como un plugin. Si la subcarpeta contiene un archivo `plugin.json` válido y un `init.lua`, SaveCloud lo carga y lo ejecuta dentro de un entorno Lua aislado.

Tu plugin puede definir funciones **hook** que SaveCloud llama automáticamente durante eventos del ciclo de vida (como cuando un juego arranca, se cierra, se detecta un guardado, o durante la sincronización). Además, puedes usar la API global `savecloud` para persistir datos (`storage`), consultar tu biblioteca de juegos (`games`), emitir notificaciones y toasts (`notifications`, `ui`), o realizar peticiones de red (`http`).

---

## Estructura de carpetas

```
plugins/
  mi-plugin/
    plugin.json      (obligatorio)
    init.lua         (obligatorio)
    helpers.lua      (opcional, puedes requerirlo con require("helpers"))
```

### `plugin.json` (Manifiesto Obligatorio)

Todo plugin debe incluir un archivo `plugin.json` en la raíz de su carpeta:

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

- **`id`**: Identificador único del plugin (letras, números y puntos).
- **`name`**: Nombre visible del plugin.
- **`version`**: Versión del plugin (semver).
- **`api_version`**: Debe ser `1` para ser compatible con la versión actual de SaveCloud.
- **`enabled`**: Si es `false`, el plugin no se cargará (por defecto `true`).
- **`hooks`** _(opcional)_: Objeto de ajustes avanzados para los hooks:
  - **`on_pre_upload_timeout_ms`**: Timeout máximo en milisegundos para `on_pre_upload` (por defecto 2000ms, rango permitido: 250ms - 10000ms).

> [!NOTE]
> **No necesitas registrar los hooks en `plugin.json`:** SaveCloud detecta automáticamente qué hooks has implementado buscando si la función existe en el archivo `init.lua`. La sección `"hooks"` en `plugin.json` es únicamente para configurar parámetros opcionales como timeouts.

---

## Ejemplo mínimo

```lua
-- plugins/mi-plugin/init.lua

function on_init()
    savecloud.log.info("Mi plugin cargó correctamente")
end
```

---

## Hooks Disponibles

Los hooks son funciones Lua globales que defines en tu `init.lua`. SaveCloud utiliza **auto-descubrimiento**: cuando ocurre un evento, comprueba si definiste esa función en Lua y la ejecuta; si no la definiste, simplemente continúa sin errores. No necesitas declarar nada en el JSON ni implementar hooks que no uses.

### 1. `on_init()`

Se llama una vez al iniciar la aplicación cuando el plugin es cargado.

```lua
function on_init()
    savecloud.log.info("Plugin iniciado")
end
```

### 2. `on_game_start(game)`

Se ejecuta cuando SaveCloud detecta que un juego ha comenzado su ejecución.

- **`game`**: Tabla con la información del juego:
  - `game.id` (string): Identificador único del juego (ej: `"elden-ring"`).
  - `game.name` (string): Nombre del juego (ej: `"Elden Ring"`).

```lua
function on_game_start(game)
    savecloud.log.info("Juego iniciado: " .. game.name)
    savecloud.notifications.show_overlay("Companion", "¡A jugar " .. game.name .. "!")
end
```

### 3. `on_game_exit(game, session)`

Se ejecuta cuando el juego se cierra.

- **`game`**: Tabla con `id` y `name`.
- **`session`**: Tabla con información de la sesión:
  - `session.duration_secs` (número): Tiempo total jugado en segundos durante esta sesión.

```lua
function on_game_exit(game, session)
    local minutos = math.floor(session.duration_secs / 60)
    savecloud.log.info("Juego cerrado tras " .. minutos .. " minutos")
    savecloud.ui.show_toast(game.name .. ": sesión de " .. minutos .. " min finalizada", "info")
end
```

### 4. `on_save_detected(game, save_path)`

Se dispara en tiempo real cuando el observador de archivos detecta una modificación en las carpetas de guardado del juego.

- **`game`**: Tabla con `id`.
- **`save_path`** (string): Ruta física absoluta del archivo modificado.

```lua
function on_save_detected(game, save_path)
    savecloud.log.debug("Guardado detectado en: " .. save_path)
end
```

### 5. `on_pre_upload(data, context)`

Hook de pipeline llamado antes de subir un archivo de guardado a la nube.
Recibe los bytes crudos del archivo y devuelve los bytes modificados (o los mismos sin alterar).

- **`data`** (string): Buffer binario de los bytes del archivo.
- **`context`**: Tabla de contexto:
  - `context.game_id` (string): ID del juego.
  - `context.filename` (string): Nombre relativo del archivo en el conjunto de partidas.

```lua
function on_pre_upload(data, context)
    savecloud.log.info("Procesando " .. context.filename .. " (" .. #data .. " bytes)")
    -- Puedes transformar data o retornarlo sin cambios
    return data
end
```

### 6. `on_post_upload(summary)`

Se llama tras finalizar el proceso de sincronización/subida de partidas de un juego.

- **`summary`**:
  - `summary.game_id` (string): ID del juego sincronizado.
  - `summary.ok` (boolean): `true` si todos los archivos se subieron sin errores.
  - `summary.files_count` (número): Cantidad total de archivos procesados.
  - `summary.error_count` (número): Cantidad de archivos que fallaron.

```lua
function on_post_upload(summary)
    if summary.ok then
        savecloud.notifications.show_overlay("Sincronización Exitosa", summary.game_id .. " guardado en la nube.")
    end
end
```

---

## La API de SaveCloud (`savecloud.*`)

SaveCloud expone una tabla global llamada `savecloud` con los siguientes módulos.

### `savecloud.storage` (Persistencia SQLite Aislada)

Almacenamiento clave-valor persistente en la base de datos de SaveCloud. Cada plugin tiene su propio espacio de nombres aislado.

```lua
-- Guardar o actualizar un valor
savecloud.storage.set("ultimo_juego", "elden-ring")

-- Leer un valor (devuelve nil si no existe)
local val = savecloud.storage.get("ultimo_juego")

-- Eliminar una clave
savecloud.storage.delete("ultimo_juego")

-- Listar todas las claves guardadas por este plugin
local keys = savecloud.storage.list_keys()

-- Borrar todos los datos de este plugin
savecloud.storage.clear()
```

### `savecloud.notifications` (Notificaciones & Overlay)

Envía notificaciones de escritorio o avisos visuales en el In-Game Overlay de SaveCloud.

```lua
-- Notificación de escritorio + overlay
savecloud.notifications.show("Título", "Mensaje informativo")

-- Notificación exclusiva en el Overlay del juego
savecloud.notifications.show_overlay("SaveCloud", "Partida sincronizada")
```

### `savecloud.games` (Consulta de Biblioteca)

Permite consultar la biblioteca de juegos configurada en SaveCloud y verificar si un juego se está ejecutando.

```lua
-- Obtener todos los juegos configurados
local juegos = savecloud.games.get_all()
for _, g in ipairs(juegos) do
    savecloud.log.info("Juego: " .. g.name .. " (Corriendo: " .. tostring(g.is_running) .. ")")
end

-- Obtener un juego específico por ID
local game = savecloud.games.get("elden-ring")
if game then
    savecloud.log.info("Rutas: " .. table.concat(game.paths, ", "))
end

-- Comprobar si un juego está en ejecución
if savecloud.games.is_running("elden-ring") then
    savecloud.log.info("Elden Ring está corriendo")
end
```

### `savecloud.log` (Registro de Traza)

Envía logs al panel de diagnóstico de la app y terminal en tiempo real.

```lua
savecloud.log.info("Mensaje informativo")
savecloud.log.warn("Mensaje de advertencia")
savecloud.log.error("Mensaje de error")
savecloud.log.debug("Mensaje de depuración")
```

### `savecloud.ui` (Frontend & Toasts)

Interacción con la interfaz de usuario.

```lua
-- Mostrar un toast flotante en la interfaz
savecloud.ui.show_toast("Operación completada", "success") -- "info" | "warn" | "error" | "success"

-- Emitir un evento IPC personalizado hacia componentes frontend
savecloud.ui.emit("mi_evento_personalizado", "datos en formato string o json")
```

### `savecloud.http` (Peticiones de Red)

Permite realizar peticiones HTTP síncronas sin romper el plugin ante fallos de red.

```lua
local res = savecloud.http.get("https://api.example.com/status")
if res.ok then
    savecloud.log.info("Respuesta: " .. res.body)
else
    savecloud.log.error("Fallo HTTP: " .. (res.error or tostring(res.status)))
end

-- POST con headers
local res = savecloud.http.post(
    "https://api.example.com/data",
    '{"key":"value"}',
    { ["Content-Type"] = "application/json" }
)
```

---

## Autocompletado en el Editor (VS Code / LuaLS)

SaveCloud incluye un archivo de definiciones Lua llamado `savecloud-api.lua` (puedes exportarlo desde la sección de Desarrollo en Ajustes de la app).

Coloca `savecloud-api.lua` en la misma carpeta que tu `init.lua` para obtener autocompletado y tipado inline completo con la extensión **Lua by sumneko** en VS Code.

---

## Restricciones de Seguridad

Las siguientes librerías estándar de Lua están deshabilitadas:

- `os` -- sin acceso arbitrario al sistema operativo
- `io` -- sin acceso no controlado al sistema de archivos

Utiliza `savecloud.storage` para persistencia, `savecloud.http` para red, y las funciones de hooks para procesamiento de partidas.
