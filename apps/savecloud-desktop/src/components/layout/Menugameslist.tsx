import { useRef, type ChangeEvent } from "react";
import { Search, Gamepad2 } from "lucide-react";
import { useGameMedia } from "@hooks/useGameMedia";
import { useMenuGamesList } from "@hooks/useMenuGameList";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";

/**
 * Props para {@link MenuGameItem}.
 */
interface MenuGameItemProps {
  /** Juego a renderizar. */
  game: ConfiguredGame;
  /** Steam App ID ya resuelto para este juego. */
  resolvedSteamAppId?: string;
  /**
   * Mapa batch de media. `null` = batch aún cargando.
   * Se pasa directamente a `useGameMedia` para evitar queries individuales.
   */
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  /** Callback al hacer clic sobre el juego. */
  onClick?: (game: ConfiguredGame) => void;
}

/**
 * Props para {@link MenuGamesList}.
 */
export interface MenuGamesListProps {
  /** Lista completa de juegos configurados en la aplicación. */
  games: readonly ConfiguredGame[];
  /**
   * Callback que se ejecuta al seleccionar un juego de la lista.
   * Recibe el objeto `ConfiguredGame` completo.
   */
  onGameClick?: (game: ConfiguredGame) => void;
}

const MENU_GAMES_STYLES = `
.mg-scope {
  --mg-gap: 0.35rem;
  --mg-img-size: 36px;
  --mg-radius: 0.5rem;
  --mg-item-pad: 0.45rem 0.6rem;
  --mg-skeleton-bg: color-mix(in oklab, var(--heroui-default-200, #e4e4e7) 60%, transparent);
}
.dark .mg-scope,
[data-theme='dark'] .mg-scope {
  --mg-skeleton-bg: color-mix(in oklab, #27272a 80%, transparent);
}

.mg-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 0.75rem;
}
.mg-search-icon {
  position: absolute;
  left: 0.65rem;
  color: var(--heroui-default-400, #a1a1aa);
  pointer-events: none;
  display: flex;
  align-items: center;
}
.mg-search-input {
  width: 100%;
  background: color-mix(in oklab, var(--heroui-default-100, #f4f4f5) 70%, transparent);
  border: 1px solid color-mix(in oklab, var(--heroui-default-300, #d4d4d8) 60%, transparent);
  border-radius: 0.5rem;
  padding: 0.45rem 0.75rem 0.45rem 2rem;
  font-size: 0.8rem;
  color: var(--heroui-foreground, #18181b);
  outline: none;
  transition: border-color 0.18s, background 0.18s;
  line-height: 1.4;
}
.dark .mg-search-input,
[data-theme='dark'] .mg-search-input {
  background: color-mix(in oklab, #27272a 70%, transparent);
  border-color: color-mix(in oklab, #52525b 55%, transparent);
  color: #f4f4f5;
}
.mg-search-input::placeholder {
  color: var(--heroui-default-400, #a1a1aa);
}
.mg-search-input:focus {
  border-color: var(--heroui-primary, #6366f1);
  background: color-mix(in oklab, var(--heroui-default-100, #f4f4f5) 90%, transparent);
}
.dark .mg-search-input:focus,
[data-theme='dark'] .mg-search-input:focus {
  background: color-mix(in oklab, #3f3f46 80%, transparent);
}

.mg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mg-gap);
  max-height: min(50vh, 480px);
  overflow-y: auto;
  overflow-x: hidden;
}

.mg-item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: var(--mg-item-pad);
  border-radius: var(--mg-radius);
  cursor: pointer;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
  transition: background 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  color: var(--heroui-foreground, #18181b);
}
.dark .mg-item,
[data-theme='dark'] .mg-item {
  color: #f4f4f5;
}
.mg-item:hover {
  background: color-mix(in oklab, var(--heroui-default-100, #f4f4f5) 80%, transparent);
}
.dark .mg-item:hover,
[data-theme='dark'] .mg-item:hover {
  background: color-mix(in oklab, #3f3f46 70%, transparent);
}
.mg-item:focus-visible {
  outline: 2px solid var(--heroui-primary, #6366f1);
  outline-offset: 2px;
}

.mg-thumb-wrap {
  flex: 0 0 var(--mg-img-size);
  width: var(--mg-img-size);
  height: var(--mg-img-size);
  border-radius: 6px;
  overflow: hidden;
  background: var(--mg-skeleton-bg);
  position: relative;
}
.mg-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: opacity 0.2s ease;
}
.mg-thumb[data-loaded="false"] {
  opacity: 0;
}
.mg-thumb[data-loaded="true"] {
  opacity: 1;
}
.mg-thumb-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--heroui-default-400, #a1a1aa);
}

.mg-name {
  font-size: 0.8rem;
  font-weight: 500;
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  letter-spacing: -0.01em;
  flex: 1;
}

.mg-skeleton-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mg-gap);
}
.mg-skeleton-item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: var(--mg-item-pad);
}
.mg-skeleton-thumb {
  flex: 0 0 var(--mg-img-size);
  width: var(--mg-img-size);
  height: var(--mg-img-size);
  border-radius: 6px;
  background: var(--mg-skeleton-bg);
  animation: mg-pulse 1.4s ease-in-out infinite;
}
.mg-skeleton-text {
  flex: 1;
  height: 0.75rem;
  border-radius: 4px;
  background: var(--mg-skeleton-bg);
  animation: mg-pulse 1.4s ease-in-out infinite;
}
.mg-skeleton-text-sm {
  width: 60%;
  margin-top: 0.3rem;
}
@keyframes mg-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.mg-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem 0;
  color: var(--heroui-default-400, #a1a1aa);
  text-align: center;
}
.mg-empty-text {
  font-size: 0.78rem;
  line-height: 1.4;
}

.mg-section-title {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--heroui-default-400, #a1a1aa);
  margin: 0 0 0.5rem 0;
  padding-left: 0.15rem;
}
`;

/**
 * Esqueleto de carga que imita la forma de los ítems reales.
 * Se muestra mientras el batch de media aún no ha respondido.
 *
 * @param count - Número de esqueletos a mostrar.
 */
function MenuGamesSkeletons({ count }: { count: number }) {
  return (
    <div className="mg-skeleton-wrap" aria-hidden="true">
      {Array.from({ length: Math.min(count, 6) }).map((_, i) => (
        <div key={i} className="mg-skeleton-item">
          <div className="mg-skeleton-thumb" />
          <div style={{ flex: 1 }}>
            <div className="mg-skeleton-text" />
            <div className="mg-skeleton-text mg-skeleton-text-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Renderiza un ítem de juego individual dentro de la lista del menú.
 *
 * Usa {@link useGameMedia} pasando el mapa batch para evitar queries
 * individuales duplicadas.
 */
function MenuGameItem({ game, resolvedSteamAppId, mediaBySteamAppId, onClick }: MenuGameItemProps) {
  const { displayImageUrl, imgLoaded, imgError, handleImgLoad, handleImgError } = useGameMedia({
    game,
    resolvedSteamAppId,
    mediaBySteamAppId,
    mediaFromBatch: true,
  });

  const showFallback = !displayImageUrl || imgError;

  return (
    <li>
      <button
        type="button"
        className="mg-item"
        aria-label={`Ir a ${formatGameDisplayName(game.id)}`}
        onClick={() => onClick?.(game)}>
        {/* Thumbnail */}
        <div className="mg-thumb-wrap" aria-hidden="true">
          {!showFallback && (
            <img
              src={displayImageUrl!}
              alt=""
              className="mg-thumb"
              data-loaded={imgLoaded ? "true" : "false"}
              onLoad={handleImgLoad}
              onError={handleImgError}
              draggable={false}
            />
          )}
          {(showFallback || !imgLoaded) && (
            <span className="mg-thumb-fallback">
              <Gamepad2 size={18} strokeWidth={1.5} />
            </span>
          )}
        </div>

        {/* Nombre */}
        <span className="mg-name">{formatGameDisplayName(game.id)}</span>
      </button>
    </li>
  );
}

/**
 * Sección de juegos para el panel lateral del menú (`StaggeredMenu`).
 *
 * Incluye:
 * - Campo de búsqueda con debounce de {@link SEARCH_DEBOUNCE_MS} ms.
 * - Lista filtrada de juegos con imagen en miniatura obtenida mediante
 *   la query batch de media de Steam.
 * - Esqueletos de carga mientras llegan los datos.
 * - Estado vacío cuando ningún juego coincide con la búsqueda.
 *
 * @example
 * ```tsx
 * <MenuGamesList
 *   games={configuredGames}
 *   onGameClick={(game) => navigate(`/games/${game.id}`)}
 * />
 * ```
 */
export function MenuGamesList({ games, onGameClick }: MenuGamesListProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const { searchValue, setSearchValue, filteredGames, mediaBySteamAppId, resolvedSteamAppIds, isBatchLoading } =
    useMenuGamesList({ games });

  /** Handler del input; actualiza el estado de búsqueda. */
  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
  };

  return (
    <div className="mg-scope">
      <style>{MENU_GAMES_STYLES}</style>

      {/* Título de sección */}
      <p className="mg-section-title" aria-label="Sección juegos">
        Juegos
      </p>

      {/* Barra de búsqueda */}
      <div className="mg-search-wrap">
        <span className="mg-search-icon" aria-hidden="true">
          <Search size={13} />
        </span>
        <input
          ref={inputRef}
          type="search"
          className="mg-search-input"
          placeholder="Filtrar librería"
          value={searchValue}
          onChange={handleSearchChange}
          aria-label="Filtrar juegos"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* Contenido */}
      {isBatchLoading ? (
        <MenuGamesSkeletons count={games.length} />
      ) : filteredGames.length === 0 ? (
        <div className="mg-empty" role="status" aria-live="polite">
          <Gamepad2 size={28} strokeWidth={1.2} />
          <p className="mg-empty-text">
            {searchValue.trim() ? `Sin resultados para "${searchValue.trim()}"` : "No hay juegos configurados"}
          </p>
        </div>
      ) : (
        <ul className="mg-list" role="list" aria-label="Lista de juegos">
          {filteredGames.map((game) => (
            <MenuGameItem
              key={game.id}
              game={game}
              resolvedSteamAppId={resolvedSteamAppIds[game.id] ?? undefined}
              mediaBySteamAppId={mediaBySteamAppId}
              onClick={onGameClick}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
