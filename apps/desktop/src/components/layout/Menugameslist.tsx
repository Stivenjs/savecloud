import { useRef, useState, type ChangeEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Search, Gamepad2 } from "lucide-react";
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
  /**
   * Modo TV/mando: tipografía y miniaturas más grandes; opcional lista plegada (ver props siguientes).
   */
  bigPictureConsole?: boolean;
  /**
   * Solo con `bigPictureConsole`: empieza con la biblioteca expandida (por defecto `false`).
   */
  bigPictureGamesStartExpanded?: boolean;
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
  flex: 0 0 auto;
  width: 64px;
  height: 36px;
  border-radius: calc(var(--mg-radius) * 0.75);
  overflow: hidden;
  background: var(--mg-skeleton-bg);
  position: relative;
}
.mg-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
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
  flex: 0 0 auto;
  width: 64px;
  height: 36px;
  border-radius: calc(var(--mg-radius) * 0.75);
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

.mg-scope.mg-bp-console {
  --mg-gap: clamp(0.45rem, 1.1vh, 0.65rem);
  --mg-radius: 0.65rem;
  --mg-item-pad: clamp(0.55rem, 1.2vh, 0.85rem) clamp(0.75rem, 1.8vw, 1rem);
}
.mg-scope.mg-bp-console .mg-section-title {
  font-size: clamp(0.75rem, min(1.5vw, 1.85vh), 0.875rem);
  margin-bottom: clamp(0.55rem, 1.2vh, 0.85rem);
  letter-spacing: 0.07em;
}
.mg-scope.mg-bp-console .mg-search-wrap {
  margin-bottom: clamp(0.85rem, 1.8vh, 1.15rem);
}
.mg-scope.mg-bp-console .mg-search-input {
  font-size: clamp(0.9rem, min(2vw, 2.35vh), 1.05rem);
  padding: clamp(0.55rem, 1.2vh, 0.75rem) 0.85rem clamp(0.55rem, 1.2vh, 0.75rem)
    clamp(2.35rem, 5vw, 2.85rem);
  border-radius: 0.625rem;
  line-height: 1.35;
}
.mg-scope.mg-bp-console .mg-search-icon {
  left: clamp(0.75rem, 2vw, 1rem);
}
.mg-scope.mg-bp-console .mg-search-icon svg {
  width: clamp(1rem, 2.6vw, 1.25rem);
  height: clamp(1rem, 2.6vw, 1.25rem);
}
.mg-scope.mg-bp-console .mg-list {
  max-height: min(42vh, 520px);
  gap: var(--mg-gap);
}
.mg-scope.mg-bp-console .mg-item {
  min-height: clamp(3rem, 6.25vh, 3.85rem);
  gap: clamp(0.85rem, 2vw, 1.15rem);
  border-radius: var(--mg-radius);
}
.mg-scope.mg-bp-console .mg-thumb-wrap {
  width: clamp(76px, 18vw, 104px);
  height: clamp(42px, 10vw, 58px);
  border-radius: calc(var(--mg-radius) * 0.8);
}
.mg-scope.mg-bp-console .mg-thumb-fallback svg {
  width: clamp(1.35rem, 3.2vw, 1.65rem);
  height: clamp(1.35rem, 3.2vw, 1.65rem);
}
.mg-scope.mg-bp-console .mg-name {
  font-size: clamp(0.92rem, min(2vw, 2.35vh), 1.12rem);
  font-weight: 600;
  line-height: 1.28;
}
.mg-scope.mg-bp-console .mg-empty {
  padding: clamp(1.75rem, 4vh, 2.35rem) 0;
}
.mg-scope.mg-bp-console .mg-empty-text {
  font-size: clamp(0.88rem, min(2vw, 2.2vh), 1rem);
}
.mg-scope.mg-bp-console .mg-skeleton-item {
  min-height: clamp(3rem, 6.25vh, 3.85rem);
  gap: clamp(0.85rem, 2vw, 1.15rem);
}
.mg-scope.mg-bp-console .mg-skeleton-thumb {
  width: clamp(76px, 18vw, 104px);
  height: clamp(42px, 10vw, 58px);
  border-radius: calc(var(--mg-radius) * 0.8);
}
.mg-scope.mg-bp-console .mg-skeleton-text {
  height: clamp(0.8rem, 2vh, 0.95rem);
}
  
.mg-scope.mg-bp-console .mg-bp-library-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 0.75rem;
  min-height: clamp(3rem, 6.75vh, 4rem);
  margin: 0 0 clamp(0.65rem, 1.25vh, 0.95rem) 0;
  padding: clamp(0.65rem, 1.4vh, 1rem) clamp(1rem, 2vw, 1.25rem);
  border: none;
  border-radius: 0.65rem;
  cursor: pointer;
  text-align: left;
  font-size: clamp(1.05rem, min(2.1vw, 2.55vh), 1.3rem);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--heroui-foreground, #18181b);
  background: color-mix(in oklab, var(--heroui-default-100, #f4f4f5) 55%, transparent);
  transition: background 0.18s ease, transform 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}
.dark .mg-scope.mg-bp-console .mg-bp-library-toggle,
[data-theme='dark'] .mg-scope.mg-bp-console .mg-bp-library-toggle {
  color: #f4f4f5;
  background: color-mix(in oklab, #3f3f46 45%, transparent);
}
.mg-scope.mg-bp-console .mg-bp-library-toggle:hover {
  background: color-mix(in oklab, var(--heroui-default-100, #f4f4f5) 82%, transparent);
}
.dark .mg-scope.mg-bp-console .mg-bp-library-toggle:hover,
[data-theme='dark'] .mg-scope.mg-bp-console .mg-bp-library-toggle:hover {
  background: color-mix(in oklab, #52525b 55%, transparent);
}
.mg-scope.mg-bp-console .mg-bp-library-toggle:focus-visible {
  outline: 2px solid var(--heroui-primary, #6366f1);
  outline-offset: 2px;
}
.mg-scope.mg-bp-console .mg-bp-library-toggle-count {
  font-size: clamp(0.78rem, min(1.6vw, 1.9vh), 0.92rem);
  font-weight: 600;
  opacity: 0.72;
  white-space: nowrap;
}
.mg-scope.mg-bp-console .mg-bp-library-toggle svg {
  flex-shrink: 0;
  opacity: 0.85;
  width: clamp(1.35rem, 3.2vw, 1.6rem);
  height: clamp(1.35rem, 3.2vw, 1.6rem);
  transition: transform 0.28s ease;
}
.mg-scope.mg-bp-console .mg-bp-library-toggle[aria-expanded='true'] svg {
  transform: rotate(180deg);
}

.mg-library-expand {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.42s cubic-bezier(0.16, 1, 0.3, 1);
}
.mg-library-expand[data-expanded='true'] {
  grid-template-rows: 1fr;
}
.mg-library-expand-inner {
  overflow: hidden;
  min-height: 0;
  opacity: 0;
  transform: translateY(-6px);
  transition:
    opacity 0.26s cubic-bezier(0.16, 1, 0.3, 1) 0.04s,
    transform 0.42s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}
.mg-library-expand[data-expanded='true'] .mg-library-expand-inner {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
  transition:
    opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1) 0.05s,
    transform 0.42s cubic-bezier(0.16, 1, 0.3, 1) 0.02s;
}
@media (prefers-reduced-motion: reduce) {
  .mg-library-expand,
  .mg-library-expand-inner {
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
  }
  .mg-library-expand-inner {
    transform: none !important;
  }
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
  const { capsuleImage, imgLoaded, imgError, handleImgLoad, handleImgError } = useGameMedia({
    game,
    resolvedSteamAppId,
    mediaBySteamAppId,
    mediaFromBatch: true,
  });

  const imageUrl = capsuleImage;
  const showFallback = !imageUrl || imgError;

  return (
    <button
      type="button"
      className="mg-item"
      aria-label={`Ir a ${formatGameDisplayName(game.id)}`}
      onClick={() => onClick?.(game)}>
      <div className="mg-thumb-wrap" aria-hidden="true">
        {!showFallback && (
          <img
            src={imageUrl}
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

      <span className="mg-name">{formatGameDisplayName(game.id)}</span>
    </button>
  );
}

const MG_LIST_CONTAINER = {
  hidden: {
    transition: { staggerChildren: 0.03, staggerDirection: -1 },
  },
  show: {
    transition: { staggerChildren: 0.045, delayChildren: 0.08 },
  },
} as const;

const MG_LIST_ITEM = {
  hidden: {
    opacity: 0,
    y: 8,
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
  },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.85 },
  },
} as const;

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
export function MenuGamesList({
  games,
  onGameClick,
  bigPictureConsole = false,
  bigPictureGamesStartExpanded = false,
}: MenuGamesListProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reduceMotionFm = useReducedMotion();
  const hasGames = games.length > 0;
  const collapsibleLibrary = Boolean(bigPictureConsole && hasGames);

  const [libraryExpanded, setLibraryExpanded] = useState(bigPictureGamesStartExpanded);

  const { searchValue, setSearchValue, filteredGames, mediaBySteamAppId, resolvedSteamAppIds, isBatchLoading } =
    useMenuGamesList({ games });

  /** Handler del input; actualiza el estado de búsqueda. */
  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
  };

  const shellClass = ["mg-scope", bigPictureConsole ? "mg-bp-console" : ""].filter(Boolean).join(" ");

  const searchIconSize = bigPictureConsole ? 17 : 13;
  const emptyIconSize = bigPictureConsole ? 36 : 28;

  const useAnimatedBpList = bigPictureConsole && !reduceMotionFm && !isBatchLoading && filteredGames.length > 0;

  const gamesListSection = isBatchLoading ? (
    <MenuGamesSkeletons count={games.length} />
  ) : filteredGames.length === 0 ? (
    <div className="mg-empty" role="status" aria-live="polite">
      <Gamepad2 size={emptyIconSize} strokeWidth={1.2} />
      <p className="mg-empty-text">
        {searchValue.trim() ? `Sin resultados para "${searchValue.trim()}"` : "No hay juegos configurados"}
      </p>
    </div>
  ) : useAnimatedBpList ? (
    <motion.ul
      className="mg-list"
      role="list"
      aria-label="Lista de juegos"
      variants={MG_LIST_CONTAINER}
      initial={false}
      animate={!collapsibleLibrary || libraryExpanded ? "show" : "hidden"}>
      {filteredGames.map((game) => (
        <motion.li key={game.id} variants={MG_LIST_ITEM} style={{ listStyle: "none" }}>
          <MenuGameItem
            game={game}
            resolvedSteamAppId={resolvedSteamAppIds[game.id] ?? undefined}
            mediaBySteamAppId={mediaBySteamAppId}
            onClick={onGameClick}
          />
        </motion.li>
      ))}
    </motion.ul>
  ) : (
    <ul className="mg-list" role="list" aria-label="Lista de juegos">
      {filteredGames.map((game) => (
        <li key={game.id}>
          <MenuGameItem
            game={game}
            resolvedSteamAppId={resolvedSteamAppIds[game.id] ?? undefined}
            mediaBySteamAppId={mediaBySteamAppId}
            onClick={onGameClick}
          />
        </li>
      ))}
    </ul>
  );

  const gamesBody = (
    <>
      <div className="mg-search-wrap">
        <span className="mg-search-icon" aria-hidden="true">
          <Search size={searchIconSize} />
        </span>
        <input
          ref={inputRef}
          type="search"
          className="mg-search-input"
          placeholder="Filtrar biblioteca"
          value={searchValue}
          onChange={handleSearchChange}
          aria-label="Filtrar juegos"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {gamesListSection}
    </>
  );

  return (
    <div className={shellClass}>
      <style>{MENU_GAMES_STYLES}</style>

      {collapsibleLibrary ? (
        <button
          type="button"
          className="mg-bp-library-toggle"
          aria-expanded={libraryExpanded}
          aria-controls="menu-games-list-body"
          onClick={() => setLibraryExpanded((v) => !v)}>
          <span>Biblioteca</span>
          <span className="inline-flex shrink-0 items-center gap-2">
            <span className="mg-bp-library-toggle-count">{`${games.length} juego${games.length === 1 ? "" : "s"}`}</span>
            <ChevronDown aria-hidden />
          </span>
        </button>
      ) : (
        <p className="mg-section-title" aria-label="Sección juegos">
          Juegos
        </p>
      )}

      {collapsibleLibrary ? (
        <div id="menu-games-list-body" className="mg-library-expand" data-expanded={libraryExpanded}>
          <div
            className="mg-library-expand-inner"
            inert={!libraryExpanded ? true : undefined}
            aria-hidden={!libraryExpanded}>
            {gamesBody}
          </div>
        </div>
      ) : (
        <div id="menu-games-list-body">{gamesBody}</div>
      )}
    </div>
  );
}
