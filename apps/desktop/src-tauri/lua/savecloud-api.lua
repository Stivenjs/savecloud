-- /apps/savecloud-desktop/src-tauri/lua/savecloud-api.lua
-- Archivo de definiciones de SaveCloud para autocompletado en el editor.
-- Coloca este archivo en la misma carpeta que tu script 'init.lua'.
--
-- Requisitos de runtime:
-- - El plugin debe incluir `plugin.json` obligatorio.
-- - `plugin.json.api_version` debe ser 1 para ser compatible.
-- - `plugin.json.enabled` permite activar/desactivar carga.
-- - `plugin.json.hooks.on_pre_upload_timeout_ms` configura timeout de pre-upload.

---@meta

--- Información básica de un juego registrado en SaveCloud.
---@class GameInfo
---@field id string Identificador único del juego (ej: "elden-ring").
---@field name string Nombre para mostrar del juego (ej: "Elden Ring").
---@field paths? string[] Rutas de guardado locales monitoreadas.
---@field steam_app_id? integer App ID de Steam asociado (si aplica).
---@field is_running? boolean True si el juego está en ejecución activa.

--- Información de la sesión de juego finalizada.
---@class SessionInfo
---@field duration_secs integer Duración de la sesión en segundos.

--- Contexto pasado durante la transformación previa a la subida de un archivo.
---@class UploadContext
---@field game_id string Identificador del juego al que pertenece el archivo.
---@field filename string Ruta relativa del archivo dentro del conjunto de guardados.

--- Resumen del resultado tras completar la subida de partidas de un juego.
---@class PostUploadSummary
---@field game_id string Identificador del juego sincronizado.
---@field ok boolean True si la subida finalizó sin errores.
---@field files_count integer Cantidad de archivos procesados.
---@field error_count integer Cantidad de errores ocurridos durante la subida.

--- API de logging del plugin para trazas informativas, advertencias y errores.
---@class SaveCloudLog
---@field info fun(mensaje: string) Imprime un mensaje informativo visible en el panel de logs.
---@field warn fun(mensaje: string) Imprime una advertencia visible en el panel de logs.
---@field error fun(mensaje: string) Imprime un error visible en el panel de logs.
---@field debug fun(mensaje: string) Imprime un mensaje de depuración en los logs.

--- API para interacción con la interfaz de usuario de SaveCloud.
---@class SaveCloudUI
---@field emit fun(evento: string, payload: string) Envía un evento IPC al frontend de la app.
---@field show_toast fun(mensaje: string, nivel?: "info"|"warn"|"error"|"success") Muestra una notificación toast en la app.

--- API de persistencia/auditoría para operaciones del plugin.
---@class SaveCloudDB
---@field log_operation fun(plugin: string, accion: string, detalles: string) Guarda un registro de operación en la base de datos.

--- API de almacenamiento clave-valor persistente y aislado para el plugin (SQLite).
---@class SaveCloudStorage
---@field get fun(clave: string): string|nil Obtiene el valor guardado para una clave, o nil si no existe.
---@field set fun(clave: string, valor: string): boolean Guarda o actualiza un valor asociado a una clave. Devuelve true si tuvo éxito.
---@field delete fun(clave: string): boolean Elimina una clave y su valor asociado. Devuelve true si la clave existía.
---@field list_keys fun(): string[] Devuelve un array con todas las claves almacenadas por este plugin.
---@field clear fun(): boolean Elimina todos los datos guardados por este plugin.

--- API de notificaciones para el sistema y el overlay dentro del juego.
---@class SaveCloudNotifications
---@field show fun(titulo: string, cuerpo: string) Envía una notificación de escritorio y evento al sistema.
---@field show_overlay fun(titulo: string, cuerpo: string) Muestra una notificación visual en el overlay in-game de SaveCloud.

--- API para consultar la biblioteca de juegos y su estado de ejecución.
---@class SaveCloudGames
---@field get_all fun(): GameInfo[] Devuelve la lista completa de juegos configurados en SaveCloud.
---@field get fun(game_id: string): GameInfo|nil Obtiene la información de un juego por su ID, o nil si no existe.
---@field is_running fun(game_id: string): boolean Comprueba si el ejecutable de un juego está corriendo actualmente.

--- Estructura estándar de respuesta para llamadas HTTP.
---@class SaveCloudHttpResponse
---@field ok boolean True si el status HTTP está entre 200 y 299.
---@field status integer Código de estado HTTP (200, 404, 500, etc.). Es 0 si hubo un error de red.
---@field body string Cuerpo de la respuesta como string.
---@field error string|nil Mensaje de error de red. Solo presente si ok es false y status es 0.

--- API HTTP disponible para plugins (GET, POST, PUT, DELETE).
---@class SaveCloudHttp
---@field get fun(url: string, headers?: table<string, string>): SaveCloudHttpResponse Realiza una petición GET.
---@field post fun(url: string, body: string, headers?: table<string, string>): SaveCloudHttpResponse Realiza una petición POST.
---@field put fun(url: string, body: string, headers?: table<string, string>): SaveCloudHttpResponse Realiza una petición PUT.
---@field delete fun(url: string, headers?: table<string, string>): SaveCloudHttpResponse Realiza una petición DELETE.

--- Objeto principal inyectado por SaveCloud con todos los módulos disponibles.
---@class SaveCloudCore
---@field log SaveCloudLog
---@field ui SaveCloudUI
---@field db SaveCloudDB
---@field http SaveCloudHttp
---@field storage SaveCloudStorage
---@field notifications SaveCloudNotifications
---@field games SaveCloudGames

--- Objeto global inyectado por el core de Rust en tiempo de ejecución.
--- No modifiques este valor — es solo una declaración para el autocompletado.
---@diagnostic disable-next-line: missing-fields
savecloud = {} ---@type SaveCloudCore

--------------------------------------------------------------------------------
-- HOOKS GLOBALES DEL CICLO DE VIDA (Define estas funciones en tu init.lua)
--------------------------------------------------------------------------------

--- Hook llamado una vez cuando SaveCloud carga e inicializa el plugin.
---@type fun()|nil
on_init = nil

--- Hook llamado cuando se detecta que un juego ha iniciado su ejecución.
---@type fun(game: GameInfo)|nil
on_game_start = nil

--- Hook llamado cuando se detecta que un juego se ha cerrado.
---@type fun(game: GameInfo, session: SessionInfo)|nil
on_game_exit = nil

--- Hook llamado cuando el observador de archivos detecta una modificación en un archivo de guardado.
---@type fun(game: GameInfo, save_path: string)|nil
on_save_detected = nil

--- Hook de pipeline llamado antes de subir un archivo de guardado.
--- Recibe los bytes crudos y el contexto del archivo. Puede transformar los bytes y devolverlos.
---@type fun(data: string, context: UploadContext): string|nil
on_pre_upload = nil

--- Hook llamado tras completarse la subida de partidas de un juego.
---@type fun(summary: PostUploadSummary)|nil
on_post_upload = nil