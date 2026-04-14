import { Input, Tabs, Tab } from "@heroui/react";
import { Search } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import type { ConfiguredGame } from "@app-types/config";
import { filterGamesBySearch, isSteamGame } from "@utils/gameImage";
import { useDebouncedValue } from "@hooks/useDebouncedValue";

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
  const [localSearch, setLocalSearch] = useState(searchTerm);

  const debouncedSearch = useDebouncedValue(localSearch, 300);

  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  useEffect(() => {
    onSearchChangeRef.current(debouncedSearch);
  }, [debouncedSearch]);

  useEffect(() => {
    if (searchTerm === "" && localSearch !== "") {
      setLocalSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <Input
        placeholder="Buscar juegos..."
        value={localSearch}
        onValueChange={setLocalSearch}
        startContent={<Search size={18} className="text-default-400" />}
        className="max-w-xs"
        size="md"
        variant="bordered"
        isClearable
        onClear={() => {
          setLocalSearch("");
          onSearchChangeRef.current("");
        }}
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
