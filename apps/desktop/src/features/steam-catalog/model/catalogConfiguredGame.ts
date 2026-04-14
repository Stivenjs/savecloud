import type { ConfiguredGame } from "@app-types/config";
import type { CatalogListItem } from "@services/tauri";
import { STEAM_CATALOG_GAME_ID_PREFIX } from "@utils/steamCatalogGameId";

export function catalogListItemToConfiguredGame(item: CatalogListItem): ConfiguredGame {
  return {
    id: `${STEAM_CATALOG_GAME_ID_PREFIX}${item.steamAppId}`,
    paths: [],
    steamAppId: item.steamAppId,
  };
}
