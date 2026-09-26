import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { History, LayoutGrid, Library, Search, Settings, ShieldAlert, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatGameDisplayName } from "@utils/gameImage";
import { openOrFocusSettingsWindow } from "@/windows/settingsWindow";
import { catalogListItemToConfiguredGame } from "@features/steam-catalog/model/catalogConfiguredGame";
import { useShellUiStore } from "@store/ShellUiStore";
import { STEAM_CATALOG_URL_Q } from "@/constants/constants";
import { STEAM_CATALOG_GAME_ID_PREFIX } from "@utils/steamCatalogGameId";
import type { CatalogListItem } from "@services/tauri";
import type { ConfiguredGame } from "@app-types/config";
import type {
  CatalogGameCommandItem,
  CommandItem,
  LocalGameCommandItem,
  NavigationCommandItem,
} from "./commandPaletteTypes";

interface UseCommandPaletteCommandsOptions {
  games: readonly ConfiguredGame[];
  catalogResults: CatalogListItem[];
  query: string;
  onClose: () => void;
}

export function useCommandPaletteCommands({
  games,
  catalogResults,
  query,
  onClose,
}: UseCommandPaletteCommandsOptions): CommandItem[] {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const navigationCommands: NavigationCommandItem[] = useMemo(
    () => [
      {
        type: "nav",
        id: "nav-library",
        title: t("commandPalette.navLibraryTitle", "Ir a Biblioteca"),
        subtitle: t("commandPalette.navLibrarySubtitle", "Ver todos tus juegos configurados y locales"),
        category: "navigation",
        icon: Library,
        action: () => {
          navigate("/");
          onClose();
        },
      },
      {
        type: "nav",
        id: "nav-catalog",
        title: t("commandPalette.navCatalogTitle", "Explorar Catálogo Steam"),
        subtitle: t("commandPalette.navCatalogSubtitle", "Buscar juegos oficiales, demos y parches"),
        category: "navigation",
        icon: LayoutGrid,
        action: () => {
          navigate("/catalog");
          onClose();
        },
      },
      {
        type: "nav",
        id: "nav-social",
        title: t("commandPalette.navSocialTitle", "Amigos y Social"),
        subtitle: t("commandPalette.navSocialSubtitle", "Ver quién está jugando y partidas activas"),
        category: "navigation",
        icon: Users,
        action: () => {
          navigate("/friends");
          onClose();
        },
      },
      {
        type: "nav",
        id: "nav-history",
        title: t("commandPalette.navHistoryTitle", "Historial de Actividad"),
        subtitle: t("commandPalette.navHistorySubtitle", "Registro de sincronizaciones y backups"),
        category: "navigation",
        icon: History,
        action: () => {
          navigate("/history");
          onClose();
        },
      },
      {
        type: "nav",
        id: "nav-settings",
        title: t("commandPalette.navSettingsTitle", "Configuración y Ajustes"),
        subtitle: t("commandPalette.navSettingsSubtitle", "Rutas, perfiles y observabilidad"),
        category: "navigation",
        icon: Settings,
        action: () => {
          void openOrFocusSettingsWindow();
          onClose();
        },
      },
      {
        type: "nav",
        id: "action-observability",
        title: t("commandPalette.navObservabilityTitle", "Diagnósticos y Salud WS"),
        subtitle: t("commandPalette.navObservabilitySubtitle", "Inspeccionar métricas y observabilidad remota"),
        category: "actions",
        icon: ShieldAlert,
        action: () => {
          void openOrFocusSettingsWindow();
          onClose();
        },
      },
    ],
    [navigate, onClose, t]
  );

  const localGameCommands: LocalGameCommandItem[] = useMemo(
    () =>
      games.map((game) => ({
        type: "game",
        id: `game-${game.id}`,
        title: formatGameDisplayName(game.id),
        game,
        category: "games" as const,
        action: () => {
          navigate(`/games/${game.id}`);
          onClose();
        },
      })),
    [games, navigate, onClose]
  );

  const catalogGameCommands: CatalogGameCommandItem[] = useMemo(
    () =>
      catalogResults.map((item) => ({
        type: "catalog",
        id: `catalog-${item.steamAppId}`,
        title: item.name,
        game: catalogListItemToConfiguredGame(item),
        steamAppId: item.steamAppId,
        category: "catalog" as const,
        action: () => {
          navigate(`/games/${STEAM_CATALOG_GAME_ID_PREFIX}${item.steamAppId}`);
          onClose();
        },
      })),
    [catalogResults, navigate, onClose]
  );

  return useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [...localGameCommands, ...navigationCommands];

    const filteredLocal = localGameCommands.filter(
      (command) =>
        command.title.toLowerCase().includes(normalizedQuery) || command.game.id.toLowerCase().includes(normalizedQuery)
    );
    const filteredNavigation = navigationCommands.filter(
      (command) =>
        command.title.toLowerCase().includes(normalizedQuery) ||
        (command.subtitle && command.subtitle.toLowerCase().includes(normalizedQuery))
    );
    const results: CommandItem[] = [...filteredLocal, ...catalogGameCommands, ...filteredNavigation];
    const trimmedQuery = query.trim();

    results.push({
      type: "nav",
      id: "action-search-in-catalog",
      title: t("commandPalette.searchInCatalog", {
        query: trimmedQuery,
        defaultValue: `Buscar "${trimmedQuery}" en el Catálogo Steam`,
      }),
      subtitle: t("commandPalette.searchInCatalogSubtitle", "Abrir catálogo completo con este filtro"),
      category: "actions",
      icon: Search,
      action: () => {
        useShellUiStore.getState().setCatalogBpSearchTerm(trimmedQuery);
        navigate(`/catalog?${STEAM_CATALOG_URL_Q}=${encodeURIComponent(trimmedQuery)}`);
        onClose();
      },
    });

    return results;
  }, [query, localGameCommands, catalogGameCommands, navigationCommands, navigate, onClose, t]);
}
