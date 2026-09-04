import { Input, type InputProps } from "@heroui/react";
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

import { useNavigable } from "@features/input/useNavigable";
import { getGamepadFocusClass } from "@features/input/styles";

function NavigableSegmentButton({
  segmentKey,
  label,
  selected,
  onSelect,
  compact = false,
}: {
  segmentKey: OriginFilter;
  label: string;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  const { isFocused, inputMode, navProps } = useNavigable({
    id: `filter-${segmentKey}`,
    layerId: "root",
    onPress: onSelect,
  });

  const baseClasses = [
    compact
      ? "min-h-8 shrink-0 rounded-lg px-3 py-1 text-xs font-semibold tap-highlight-transparent outline-none"
      : "min-h-11 shrink-0 rounded-lg px-4 py-2 text-base font-semibold tap-highlight-transparent outline-none sm:min-h-12 sm:px-5",
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    selected
      ? "bg-primary text-primary-foreground shadow-sm"
      : "text-default-600 hover:bg-default-200/50 dark:text-default-400 dark:hover:bg-default-100/15",
  ].join(" ");

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      {...navProps}
      className={getGamepadFocusClass(isFocused, inputMode, baseClasses)}>
      {label}
    </button>
  );
}

/** Filtro de origen ligero y navegable con mando para la biblioteca. */
function OriginSegments({
  originFilter,
  onOriginFilterChange,
  compact = false,
}: {
  originFilter: OriginFilter;
  onOriginFilterChange: (value: OriginFilter) => void;
  compact?: boolean;
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
      aria-label={t("library.filter.title")}
      className={[
        "inline-flex w-fit max-w-full flex-wrap items-center gap-1 self-start rounded-xl border border-default-200/70 bg-default-100/30 dark:border-default-100/25 dark:bg-default-50/15",
        compact ? "p-0.5" : "p-1",
      ].join(" ")}>
      {segments.map(({ key, label }) => (
        <NavigableSegmentButton
          key={key}
          segmentKey={key}
          label={label}
          selected={originFilter === key}
          onSelect={() => onOriginFilterChange(key)}
          compact={compact}
        />
      ))}
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
      <OriginSegments originFilter={originFilter} onOriginFilterChange={onOriginFilterChange} compact={!consoleMode} />
    </div>
  );
}
