import { Input, Tabs, Tab, type InputProps } from "@heroui/react";
import { Search } from "lucide-react";
import { useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { ConfiguredGame } from "@app-types/config";
import { filterGamesBySearch, isSteamGame } from "@utils/gameImage";
import { useDebouncedValue } from "@hooks/useDebouncedValue";

export type OriginFilter = "all" | "steam" | "other";

export interface GamesFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  originFilter: OriginFilter;
  onOriginFilterChange: (value: OriginFilter) => void;
  /** Ocultar el campo de búsqueda (p. ej. cuando vive en la rail de Big Picture). */
  omitSearch?: boolean;
  className?: string;
}

/** Búsqueda en biblioteca con debounce interno; reutilizable en la rail superior BP. */
export function DebouncedGamesSearchInput({
  searchTerm,
  onSearchChange,
  className = "max-w-xs",
  variant = "bordered",
  size = "md",
  compact = false,
  autoFocus,
  isClearable = true,
  classNames: inputClassNames,
  startContent: startSlot,
}: {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  className?: string;
  variant?: "flat" | "bordered" | "faded" | "underlined";
  size?: "sm" | "md" | "lg";
  compact?: boolean;
  autoFocus?: boolean;
  isClearable?: boolean;
  classNames?: InputProps["classNames"];
  /** Sustituye el icono de lupa inicial (ej. rail consola). */
  startContent?: ReactNode;
}) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo cuando el valor debounced externo cambia
  }, [searchTerm]);

  return (
    <Input
      type="text"
      aria-label="Buscar en la biblioteca"
      placeholder={compact ? "Buscar…" : "Buscar juegos..."}
      value={localSearch}
      autoFocus={autoFocus}
      onValueChange={setLocalSearch}
      onKeyDown={(e: ReactKeyboardEvent) => {
        if (e.key === "Escape") {
          setLocalSearch("");
          onSearchChangeRef.current("");
        }
      }}
      startContent={startSlot ?? <Search size={compact ? 16 : 18} className="text-default-400" />}
      className={`min-w-0 ${className}`}
      classNames={inputClassNames}
      size={compact ? "sm" : size}
      variant={variant}
      isClearable={isClearable}
      onClear={
        isClearable
          ? () => {
              setLocalSearch("");
              onSearchChangeRef.current("");
            }
          : undefined
      }
    />
  );
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

export function GamesFilters({
  searchTerm,
  onSearchChange,
  originFilter,
  onOriginFilterChange,
  omitSearch = false,
  className: rootClassName,
}: GamesFiltersProps) {
  return (
    <div
      className={`flex flex-col gap-4 sm:flex-row sm:items-center ${omitSearch ? "sm:justify-end" : "sm:justify-between"} ${rootClassName ?? ""}`}>
      {!omitSearch ? (
        <DebouncedGamesSearchInput searchTerm={searchTerm} onSearchChange={onSearchChange} className="max-w-xs" />
      ) : null}
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
