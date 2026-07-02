import { Input, Tabs, Tab, type InputProps } from "@heroui/react";
import { Search } from "lucide-react";
import { useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
  /** Big Picture / mando: filtro de origen compacto (no usa Tabs de HeroUI). */
  consoleMode?: boolean;
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
  placeholder,
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
  placeholder?: string;
}) {
  const [localSearch, setLocalSearch] = useState(searchTerm);
  const debouncedSearch = useDebouncedValue(localSearch, 300);
  const onSearchChangeRef = useRef(onSearchChange);
  const { t } = useTranslation();

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
      aria-label={t("library.searchPlaceholder")}
      placeholder={placeholder ?? (compact ? t("library.searchPlaceholderCompact") : t("library.searchPlaceholder"))}
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

/** Filtro de origen ligero para consola (evita el componente Tabs, muy pesado visualmente). */
function ConsoleOriginSegments({
  originFilter,
  onOriginFilterChange,
}: {
  originFilter: OriginFilter;
  onOriginFilterChange: (value: OriginFilter) => void;
}) {
  const { t } = useTranslation();
  const segments = [
    { key: "all" as const, label: t("library.filter.all") },
    { key: "steam" as const, label: t("library.filter.steam") },
    { key: "other" as const, label: t("library.filter.other") },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t("library.filter.title", "Filtros de origen")}
      className="inline-flex w-fit max-w-full flex-wrap items-center gap-1 self-start rounded-xl border border-default-200/70 bg-default-100/30 p-1 dark:border-default-100/25 dark:bg-default-50/15">
      {segments.map(({ key, label }) => {
        const selected = originFilter === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onOriginFilterChange(key)}
            className={[
              "min-h-11 shrink-0 rounded-lg px-4 py-2 text-base font-semibold transition-colors tap-highlight-transparent outline-none sm:min-h-12 sm:px-5",
              "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              selected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-default-600 hover:bg-default-200/50 dark:text-default-400 dark:hover:bg-default-100/15",
            ].join(" ")}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function GamesFilters({
  searchTerm,
  onSearchChange,
  originFilter,
  onOriginFilterChange,
  omitSearch = false,
  consoleMode = false,
  className: rootClassName,
}: GamesFiltersProps) {
  const { t } = useTranslation();
  const rowLayout = consoleMode
    ? "flex flex-col items-start gap-3"
    : `flex flex-col gap-4 sm:flex-row sm:items-center ${omitSearch ? "sm:justify-end" : "sm:justify-between"}`;

  return (
    <div className={`${rowLayout} ${rootClassName ?? ""}`}>
      {!omitSearch ? (
        <DebouncedGamesSearchInput
          searchTerm={searchTerm}
          onSearchChange={onSearchChange}
          className={consoleMode ? "max-w-full sm:max-w-md" : "max-w-xs"}
          size={consoleMode ? "lg" : "md"}
        />
      ) : null}
      {consoleMode ? (
        <ConsoleOriginSegments originFilter={originFilter} onOriginFilterChange={onOriginFilterChange} />
      ) : (
        <Tabs
          selectedKey={originFilter}
          onSelectionChange={(key) => onOriginFilterChange(key as OriginFilter)}
          variant="solid"
          color="primary"
          size="sm"
          aria-label={t("library.filter.title", "Filtros de origen")}>
          <Tab key="all" title={t("library.filter.all")} />
          <Tab key="steam" title={t("library.filter.steam")} />
          <Tab key="other" title={t("library.filter.other")} />
        </Tabs>
      )}
    </div>
  );
}
