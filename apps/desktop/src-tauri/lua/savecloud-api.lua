-- /apps/savecloud-desktop/src-tauri/lua/savecloud-api.lua
-- Archivo de definiciones de SaveCloud para autocompletado en el editor.
-- Coloca este archivo en la misma carpeta que tu script 'init.lua'.
--
-- Requisitos de runtime (Sprint 1):
-- - El plugin debe incluir `plugin.json` obligatorio.
-- - `plugin.json.api_version` debe ser 1 para ser compatible.
-- - `plugin.json.enabled` permite activar/desactivar carga.
-- - `plugin.json.hooks.on_pre_upload_timeout_ms` configura timeout de pre-upload.

---@meta

--- API de logging del plugin para trazas informativas y errores.
---@class SaveCloudLog
---@field info fun(mensaje: string) Imprime un mensaje informativo visible en el panel de logs.
---@field error fun(mensaje: string) Imprime un error visible en el panel de logs.

--- API para emitir eventos desde Lua hacia el frontend.
---@class SaveCloudUI
---@field emit fun(evento: string, payload: string) Envia un evento al frontend de la app.

--- API de persistencia/registro (actualmente mock) para operaciones del plugin.
---@class SaveCloudDB
---@field log_operation fun(plugin: string, accion: string, detalles: string) Guarda un registro de operacion.

--- Estructura estandar de respuesta para llamadas HTTP.
---@class SaveCloudHttpResponse
---@field ok boolean True si el status HTTP esta entre 200 y 299.
---@field status integer Codigo de estado HTTP (200, 404, 500, etc.). Es 0 si hubo un error de red.
---@field body string Cuerpo de la respuesta como string.
---@field error string|nil Mensaje de error de red. Solo presente si ok es false y status es 0.

--- API HTTP disponible para plugins (GET, POST, PUT, DELETE).
---@class SaveCloudHttp
---@field get fun(url: string, headers?: table<string, string>): SaveCloudHttpResponse Realiza una peticion GET.
---@field post fun(url: string, body: string, headers?: table<string, string>): SaveCloudHttpResponse Realiza una peticion POST.
---@field put fun(url: string, body: string, headers?: table<string, string>): SaveCloudHttpResponse Realiza una peticion PUT.
---@field delete fun(url: string, headers?: table<string, string>): SaveCloudHttpResponse Realiza una peticion DELETE.

--- Objeto principal inyectado por SaveCloud con todos los modulos disponibles.
---@class SaveCloudCore
---@field log SaveCloudLog
---@field ui SaveCloudUI
---@field db SaveCloudDB
---@field http SaveCloudHttp

--- Objeto global inyectado por el core de Rust en tiempo de ejecucion.
--- No modifiques este valor — es solo una declaracion para el autocompletado.
---@diagnostic disable-next-line: missing-fields
savecloud = {} ---@type SaveCloudCore