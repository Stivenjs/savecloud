# Notas de versión

## v1.2.0 (actual)

### API (backend)

- **Endpoints batch:** `POST /saves/upload-urls` y `POST /saves/download-urls` para obtener varias URLs firmadas en una sola petición, reduciendo invocaciones Lambda y latencia.
- Mantenidos los endpoints unitarios `upload-url` y `download-url` por compatibilidad.

### App de escritorio (Tauri)

- **Subida/descarga más rápidas:** uso de los endpoints batch de la API (una llamada por juego con todos sus archivos) en lugar de una por archivo.
- **“Subir todos” / “Descargar todos” en paralelo:** hasta 4 juegos se procesan a la vez (batch de juegos en Rust).
- **Config en la nube:** subida automática del `config.json` tras cambios (debounce 2,5 s) y respaldo periódico cada 5 minutos.
- **Conflictos de descarga en batch:** un solo chequeo de conflictos para todos los juegos antes de “Descargar todos” (`sync_check_download_conflicts_batch`).
- **Steam App ID en batch:** una llamada para resolver varios nombres de juego a Steam App ID.
- **UI:** transiciones entre pestañas (framer-motion), mejor organización de páginas (Juegos, Amigos, Configuración), modales de confirmación al importar por link y al copiar guardados de un amigo, botón Actualizar con estado de carga.
- **Estado:** menos `useState` dispersos; uso de `useReducer` en páginas principales (juegos, amigos, configuración).

### Correcciones

- Modal de plantilla (“Usar config como plantilla”) ya no mostraba “No hay juego seleccionado” al elegir un juego de amigo.
- Un solo indicador de carga en el botón Actualizar (sin Spinner duplicado).

---

## Versiones anteriores

Resúmenes breves de entregas previas (ajustar según historial real del proyecto):

- **v0.1.x:** API inicial (upload-url, download-url, list saves), CLI con menú y comandos, app de escritorio Tauri con listado de juegos, sync por juego, amigos (link compartido, User ID), configuración y respaldo del config en la nube.
