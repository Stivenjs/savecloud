import type { ConfiguredGame } from "@app-types/config";

interface NavigationCommandItem {
  type: "nav";
  id: string;
  title: string;
  subtitle?: string;
  category: "navigation" | "actions";
  icon: React.ElementType;
  action: () => void;
}

interface LocalGameCommandItem {
  type: "game";
  id: string;
  title: string;
  game: ConfiguredGame;
  category: "games";
  action: () => void;
}

interface CatalogGameCommandItem {
  type: "catalog";
  id: string;
  title: string;
  game: ConfiguredGame;
  steamAppId: string;
  category: "catalog";
  action: () => void;
}

export type { LocalGameCommandItem, CatalogGameCommandItem, NavigationCommandItem };
export type CommandItem = NavigationCommandItem | LocalGameCommandItem | CatalogGameCommandItem;
