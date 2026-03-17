import { Input, Tabs, Tab } from "@heroui/react";
import { Search } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import { filterGamesBySearch, isSteamGame } from "@utils/gameImage";

export type OriginFilter = "all" | "steam" | "other";

export interface GamesFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  originFilter: OriginFilter;
  onOriginFilterChange: (value: OriginFilter) => void;
}

export function filterGames(
  games: readonly ConfiguredGame[],
  searchTerm: string,
  originFilter: OriginFilter
): ConfiguredGame[] {
  let result = filterGamesBySearch(games, searchTerm);

  if (originFilter === "steam") {
    result = result.filter(isSteamGame);
  } else if (originFilter === "other") {
    result = result.filter((g) => !isSteamGame(g));
  }

  return result;
}

export function GamesFilters({ searchTerm, onSearchChange, originFilter, onOriginFilterChange }: GamesFiltersProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <Input
        placeholder="Buscar juegos..."
        value={searchTerm}
        onValueChange={onSearchChange}
        startContent={<Search size={18} className="text-default-400" />}
        className="max-w-xs"
        size="md"
        variant="bordered"
        isClearable
        onClear={() => onSearchChange("")}
      />
      <Tabs
        selectedKey={originFilter}
        onSelectionChange={(key) => onOriginFilterChange(key as OriginFilter)}
        variant="solid"
        color="primary"
        size="sm"
        aria-label="Filtros de origen">
        <Tab key="all" title="Todos" />
        <Tab key="steam" title="Steam" />
        <Tab key="other" title="Otros" />
      </Tabs>
    </div>
  );
}
