# Sistema de plugins -- Referencia para desarrolladores Rust

Este documento explica la arquitectura del sistema de plugins de SaveCloud, como extenderlo, y las responsabilidades de cada modulo.

---

## Descripcion general

El sistema de plugins permite que scripts Lua externos se enganchen al ciclo de vida de SaveCloud sin modificar el codigo Rust. Cada plugin corre dentro de su propia VM `mlua::Lua` aislada. La capa Rust es responsable de:

- Escanear el directorio de plugins y cargar cada plugin en un hilo separado para no bloquear la app
- Exponer una API controlada a Lua (la tabla global `savecloud`)
- Mantener un buffer de logs en memoria que recibe entradas desde los plugins en tiempo real
- Llamar las funciones hook definidas en el `init.lua` de cada plugin
- Ejecutar el pipeline de pre-subida pasando los datos por cada plugin cargado

## Contrato de carga (Sprint 1)

Desde Sprint 1, la carga es estricta y requiere un manifest `plugin.json` en la raiz de cada plugin.

### plugin.json minimo

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
- Si `plugin.json` es invalido, el plugin se omite (`manifest_invalid`).
- Si `enabled` es `false`, el plugin no se carga (`plugin_disabled`).
- Si `api_version` no coincide con la version soportada por el core, el plugin no se carga (`api_version_mismatch`).

### Compatibilidad de API

- Version soportada actualmente: `api_version = 1`.

### Timeout de hooks

- `hooks.on_pre_upload_timeout_ms` permite configurar timeout por plugin para `on_pre_upload`.
- El valor final se ajusta a limites globales del core (clamping).
- Si el hook excede timeout o falla, se registra error y el pipeline continua con los datos sin modificar.

---

## Estructura de modulos

```
src/plugins/
  mod.rs        -- Declaraciones publicas de modulos y alias de tipo compartido
  api.rs        -- Registra la API Lua de savecloud.*
  plugin.rs     -- Representa y gestiona una instancia individual de plugin
  manager.rs    -- Carga y orquesta todos los plugins
  log_buffer.rs -- Buffer en memoria de logs emitidos por plugins
```

---

## mod.rs

Declara los cuatro submodulos y exporta un alias de tipo compartido usado en toda la app:

```rust
pub type AppPluginManager = Arc<Mutex<manager::PluginManager>>;
```

Este tipo envuelve `PluginManager` en `Arc<Mutex<...>>` para que pueda compartirse de forma segura entre comandos Tauri y tareas async. Registralo como estado manejado de Tauri durante la inicializacion de la app.

---

## log_buffer.rs

### Proposito

Mantiene un buffer circular en memoria de todas las entradas de log emitidas por plugins durante la sesion activa. Los logs se pierden al cerrar la app, lo cual es el comportamiento esperado.

### LogEntry

```rust
pub struct LogEntry {
    pub timestamp: String,  // formato HH:MM:SS
    pub level: String,      // "info" o "error"
    pub plugin: String,     // nombre del plugin que emitio el log
    pub message: String,
}
```

### LogBuffer

Internamente usa `VecDeque` para que eliminar la entrada mas antigua sea O(1). El limite por defecto es 1000 entradas. Cuando se alcanza el limite, la entrada mas antigua se descarta automaticamente al insertar una nueva.

```rust
pub struct LogBuffer {
    entries: VecDeque<LogEntry>,
    max_size: usize,
}
```

### AppLogs

Alias de tipo para compartir el buffer entre hilos:

```rust
pub type AppLogs = Arc<Mutex<LogBuffer>>;
```

Registralo como estado de Tauri con `app.manage(logs.clone())` para que los comandos puedan accederlo.

### new_log_buffer

Funcion de conveniencia para crear el buffer:

```rust
pub fn new_log_buffer() -> AppLogs {
    Arc::new(Mutex::new(LogBuffer::new()))
}
```

---

## api.rs

### Proposito

`register_savecloud_api` se llama una vez por VM de plugin. Recibe `AppLogs` y `plugin_name` ademas del `AppHandle`, y construye la tabla Lua `savecloud` con tres sub-tablas (`log`, `ui`, `db`).

Tambien deshabilita los globales `os` e `io` asignandoles `nil`.

### Firma actual

```rust
pub fn register_savecloud_api(
    lua: &Lua,
    app_handle: AppHandle,
    logs: AppLogs,
    plugin_name: String,
) -> Result<()>
```

### Como funciona savecloud.log internamente

Cada llamada a `savecloud.log.info` o `savecloud.log.error` desde Lua hace tres cosas:

1. Imprime el mensaje en stdout/stderr con el nombre del plugin
2. Empuja una `LogEntry` al `LogBuffer` via `AppLogs`
3. Emite el evento `plugin_log` al frontend con la entrada serializada

El paso 2 y 3 ocurren dentro de un `tauri::async_runtime::spawn` para no bloquear el hilo del plugin.

### Agregar un nuevo modulo a la API

Para agregar un nuevo modulo (por ejemplo `savecloud.storage`):

1. Crea una nueva funcion privada siguiendo el mismo patron que las existentes:

```rust
fn register_storage_module(lua: &Lua, parent_table: &Table) -> Result<()> {
    let storage_table = lua.create_table()?;

    let read = lua.create_function(|_, key: String| {
        // tu implementacion
        Ok(String::from("valor"))
    })?;

    storage_table.set("read", read)?;
    parent_table.set("storage", storage_table)?;

    Ok(())
}
```

2. Llamala dentro de `register_savecloud_api` antes de `globals.set("savecloud", savecloud_table)`:

```rust
register_storage_module(lua, &savecloud_table)?;
```

### Acceder a AppHandle dentro de closures

El `app_handle` que se pasa a `register_ui_module` se mueve al closure con `move`. Si necesitas `AppHandle` en un nuevo modulo, clonalo antes de pasarlo a `register_savecloud_api` y reenvía el clon a tu nueva funcion:

```rust
pub fn register_savecloud_api(lua: &Lua, app_handle: AppHandle, ...) -> Result<()> {
    register_ui_module(lua, &savecloud_table, app_handle.clone())?;
    register_mi_modulo(lua, &savecloud_table, app_handle.clone())?;
}
```

---

## plugin.rs

### Proposito

La struct `Plugin` contiene dos cosas: el nombre del plugin (derivado del nombre de la carpeta) y su VM `mlua::Lua`. Cada plugin obtiene una VM completamente independiente -- no hay estado Lua compartido entre plugins.

### load_from_dir

Este es el constructor. Recibe `AppLogs` ademas de `AppHandle` y realiza estos pasos en orden:

1. Crea una nueva VM Lua
2. Extrae el nombre de la carpeta como nombre del plugin
3. Llama `register_savecloud_api` pasando el nombre del plugin para que los logs se etiqueten correctamente
4. Configura `package.path` dentro de Lua para que `require("modulo")` resuelva a archivos dentro de la carpeta del plugin
5. Lee y ejecuta `init.lua`
6. Devuelve la instancia de `Plugin` (las funciones hook no se llaman aqui)

La configuracion de `package.path` usa barras normales explicitamente para manejar correctamente las rutas de Windows:

```rust
let folder_str = dir_path.to_string_lossy().replace('\\', "/");
```

### trigger_on_init

Busca la funcion global `on_init` en el estado Lua del plugin y la llama si existe. Si el plugin no definio `on_init`, esto no hace nada. Si la funcion existe pero devuelve un error, el error se propaga al llamador.

### \_on_pre_upload

Busca `on_pre_upload`, le pasa los bytes crudos, y devuelve los bytes que retorne la funcion Lua. Si la funcion no esta definida, se devuelven los bytes originales sin cambios.

El parametro `data: &[u8]` se pasa directamente a Lua. mlua maneja la conversion a un string Lua (buffer de bytes). El tipo de retorno `Vec<u8>` tambien se espera de Lua.

### Agregar nuevos hooks

Para agregar un nuevo hook (por ejemplo `on_post_upload`):

1. Agrega un metodo a `Plugin`:

```rust
pub fn on_post_upload(&self, resultado: &str) -> Result<()> {
    let globals = self.lua.globals();

    if let Ok(func) = globals.get::<Function>("on_post_upload") {
        let _: () = func.call(resultado)?;
    }

    Ok(())
}
```

2. Llamalo desde `PluginManager` en el momento apropiado del ciclo de vida de la subida.

---

## manager.rs

### Proposito

`PluginManager` posee un `Vec<Plugin>`. Es responsable de descubrir plugins en disco y orquestar las llamadas a ellos.

### load_all

Recibe `AppLogs` y lo pasa a cada `Plugin::load_from_dir`. Itera sobre las entradas en `plugins_dir`. Por cada entrada que sea un directorio, llama `Plugin::load_from_dir`. Si la carga tiene exito, llama inmediatamente `trigger_on_init` en el nuevo plugin y luego lo agrega a `self.plugins`.

Los fallos se registran y se omiten -- un plugin malo no impide que los demas carguen.

### \_execute_pre_upload

Ejecuta el pipeline de pre-subida. Itera sobre todos los plugins cargados en orden, pasando los datos por el `_on_pre_upload` de cada uno. Si un plugin falla, el error se registra y los datos de antes de ese plugin se reenvian sin cambios al siguiente.

```
datos originales
    -> plugin_a::on_pre_upload  -> datos_modificados_a
    -> plugin_b::on_pre_upload  -> datos_modificados_b  (o originales si b falla)
    -> datos finales
```

---

## Integracion con Tauri

### setup.rs

Los plugins se cargan en un hilo separado con `std::thread::spawn` para que el `on_init` de cada plugin no bloquee el hilo principal ni congele la app, incluso si el plugin hace trabajo pesado o tiene delays.

El flujo es:

1. Crear `AppLogs` y registrarlo como estado de Tauri inmediatamente
2. Crear un `PluginManager` vacio y registrarlo como estado de Tauri inmediatamente
3. Lanzar un hilo separado que ejecuta `load_all`
4. Cuando `load_all` termina, reemplazar el contenido del manager vacio con el manager cargado

```rust
let logs = new_log_buffer();
app.manage(logs.clone());

let shared_manager: AppPluginManager = Arc::new(Mutex::new(PluginManager::new()));
app.manage(shared_manager.clone());

// Capturar el handle del runtime de Tokio antes de entrar al hilo
let tokio_handle = tauri::async_runtime::handle();
let handle = app.handle().clone();

std::thread::spawn(move || {
    let mut manager = PluginManager::new();
    manager.load_all(plugins_dir, handle, logs);

    tokio_handle.block_on(async {
        *shared_manager.lock().await = manager;
    });
});
```

Nota: se usa `tauri::async_runtime::handle()` capturado desde el hilo principal antes del spawn. No se puede llamar `tokio::runtime::Handle::current()` desde dentro del hilo nuevo porque ese hilo no tiene contexto Tokio.

### Comando get_plugin_logs

Expone los logs acumulados al frontend:

```rust
#[tauri::command]
pub async fn get_plugin_logs(
    logs: tauri::State<'_, AppLogs>
) -> Result<Vec<LogEntry>, String> {
    Ok(logs.lock().await.all())
}
```

Registralo en el `invoke_handler` de Tauri junto a los demas comandos.

### Eventos en tiempo real

Cada vez que un plugin llama `savecloud.log.info` o `savecloud.log.error`, el frontend recibe automaticamente el evento `plugin_log` con la `LogEntry` serializada. El frontend puede escucharlo con `listen("plugin_log", ...)` para actualizar el panel de logs sin necesidad de polling.

### Acceder al manager desde un comando

```rust
#[tauri::command]
async fn subir_archivo(
    data: Vec<u8>,
    manager: tauri::State<'_, AppPluginManager>,
) -> Result<(), String> {
    let procesado = manager.lock().await._execute_pre_upload(data);
    // continuar con la subida...
    Ok(())
}
```

---

## Dependencias

| Crate    | Uso                                               |
| -------- | ------------------------------------------------- |
| `mlua`   | VM Lua, bindings de funciones, creacion de tablas |
| `tauri`  | `AppHandle` para emitir eventos al frontend       |
| `tokio`  | Runtime async, `Mutex` para estado compartido     |
| `chrono` | Timestamps en los logs (`HH:MM:SS`)               |

```toml
[dependencies]
mlua = { version = "...", features = ["lua54", "vendored"] }
chrono = { version = "0.4", features = ["serde"] }
```

---

## Consideraciones de seguridad

- Los globales Lua `os` e `io` se asignan a `nil` al momento de registrar la API. Esto se hace por VM, por lo que aplica a cada plugin.
- Los plugins no pueden comunicarse entre si -- cada uno tiene su propia VM aislada sin globales compartidos.
- Los plugins solo pueden llamar las funciones explicitamente registradas en `api.rs`. No hay forma de que un plugin alcance codigo Rust que no este expuesto a traves de la tabla `savecloud`.
- Si agregas una nueva funcion a la API que realiza una operacion destructiva o privilegiada, considera si deberia estar protegida por algun tipo de verificacion de permisos antes de registrarla.
- Los plugins corren en un hilo separado del hilo principal de Tauri. Si un plugin bloquea su hilo (por ejemplo con un busy-loop en `on_init`), solo afecta ese hilo y no congela la UI.
