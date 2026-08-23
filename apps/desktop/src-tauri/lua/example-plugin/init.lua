-- Ejemplo integral de plugin para SaveCloud.
-- Muestra el uso de hooks del ciclo de vida, almacenamiento persistente (storage),
-- notificaciones en el overlay y consulta de biblioteca de juegos.
--
-- Para instalarlo, copia esta carpeta a:
--   <DataDir>/SaveCloud/plugins/example-plugin/

local plugin_name = "Session & Sync Companion"

function on_init()
  local launches = tonumber(savecloud.storage.get("total_launches") or "0") + 1
  savecloud.storage.set("total_launches", tostring(launches))
  savecloud.log.info(string.format("[%s] Inicializado. Sesión de app #%d", plugin_name, launches))
end

function on_game_start(game)
  savecloud.log.info(string.format("[GameStart] Juego iniciado: %s (ID: %s)", game.name, game.id))
  savecloud.notifications.show_overlay(
    "SaveCloud Companion",
    string.format("¡A jugar %s! Auto-sync activo.", game.name)
  )
end

function on_game_exit(game, session)
  local duration_mins = math.floor(session.duration_secs / 60)
  savecloud.log.info(string.format("[GameExit] %s cerrado tras %d segundos (%d min)", game.name, session.duration_secs, duration_mins))

  local key = "play_count_" .. game.id
  local play_count = tonumber(savecloud.storage.get(key) or "0") + 1
  savecloud.storage.set(key, tostring(play_count))

  savecloud.ui.show_toast(
    string.format("Sesión finalizada: %s (%d min jugados)", game.name, duration_mins),
    "info"
  )
end

function on_save_detected(game, save_path)
  savecloud.log.debug(string.format("[SaveDetected] Guardado detectado en: %s", save_path))
end

function on_pre_upload(data, context)
  savecloud.log.info(string.format("[PreUpload] Procesando %s para %s (%d bytes)", context.filename, context.game_id, #data))
  -- Puedes retornar `data` sin modificar o procesar los bytes según tu lógica
  return data
end

function on_post_upload(summary)
  if summary.ok then
    savecloud.log.info(string.format("[PostUpload] Sincronización exitosa de %s (%d archivos)", summary.game_id, summary.files_count))
    savecloud.notifications.show_overlay(
      "Guardado en la Nube",
      string.format("Partidas de %s sincronizadas correctamente.", summary.game_id)
    )
  else
    savecloud.log.error(string.format("[PostUpload] Falló la sincronización de %s (%d errores)", summary.game_id, summary.error_count))
  end
end
