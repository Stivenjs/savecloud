-- Ejemplo mínimo de plugin para SaveCloud (Sprint 1).
-- Copia esta carpeta al directorio real de plugins de la app:
--   <DataDir>/SaveCloud/plugins/example-plugin/
--
-- Opcional para autocompletado en editor:
-- coloca `savecloud-api.lua` en esta misma carpeta.

local plugin_name = "Example Uppercase PreUpload"

---@diagnostic disable-next-line: lowercase-global
function on_init()
  savecloud.log.info(plugin_name .. " inicializado correctamente")
end

-- Hook opcional del pipeline de subida.
-- Recibe bytes (string binario Lua) y devuelve bytes.
---@diagnostic disable-next-line: lowercase-global
function on_pre_upload(data)
  savecloud.log.info("on_pre_upload: bytes recibidos = " .. tostring(#data))

  -- Ejemplo sencillo: transforma texto ASCII a MAYÚSCULAS.
  -- Si el contenido es binario puro, puedes retornar `data` sin cambios.
  local transformed = string.upper(data)

  savecloud.log.info("on_pre_upload: bytes procesados = " .. tostring(#transformed))
  return transformed
end
