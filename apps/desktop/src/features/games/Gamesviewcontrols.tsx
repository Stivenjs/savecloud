/**
 * GamesViewControls
 * Barra de controles de visualización: ordenación (sort) + toggle de layout (grid-lg / grid-md / list).
 * Diseño coherente con el dark theme de la app (HeroUI + Tailwind).
 */

import { Select, SelectItem } from "@heroui/react";
import { LayoutGrid, Grid2X2, AlignJustify } from "lucide-react";
import type { GamesLayout, GamesSortDir, GamesSortField } from "@hooks/useGamesViewPreferences";

interface SortOption {
  key: string;
  field: GamesSortField;
  dir: GamesSortDir;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { key: "title_asc", field: "title", dir: "asc", label: "Título (A-Z)" },
  { key: "title_desc", field: "title", dir: "desc", label: "Título (Z-A)" },
  { key: "lastModified_desc", field: "lastModified", dir: "desc", label: "Modificado (reciente)" },
  { key: "lastModified_asc", field: "lastModified", dir: "asc", label: "Modificado (antiguo)" },
  { key: "playtime_desc", field: "playtime", dir: "desc", label: "Tiempo jugado (mayor)" },
  { key: "playtime_asc", field: "playtime", dir: "asc", label: "Tiempo jugado (menor)" },
  { key: "size_desc", field: "size", dir: "desc", label: "Tamaño (mayor)" },
  { key: "size_asc", field: "size", dir: "asc", label: "Tamaño (menor)" },
];

interface LayoutButtonProps {
  value: GamesLayout;
  current: GamesLayout;
  onClick: (v: GamesLayout) => void;
  label: string;
  children: React.ReactNode;
}

function LayoutButton({ value, current, onClick, label, children }: LayoutButtonProps) {
  const isActive = current === value;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isActive}
      onClick={() => onClick(value)}
      className={[
        "flex items-center justify-center rounded-lg p-2 transition-colors duration-150 cursor-pointer",
        isActive
          ? "bg-default-200 text-foreground dark:bg-default-100"
          : "text-default-400 hover:bg-default-100 hover:text-default-600 dark:hover:bg-default-50",
      ].join(" ")}>
      {children}
    </button>
  );
}

export interface GamesViewControlsProps {
  sortBy: GamesSortField;
  sortDir: GamesSortDir;
  layout: GamesLayout;
  onSortChange: (field: GamesSortField, dir: GamesSortDir) => void;
  onLayoutChange: (layout: GamesLayout) => void;
}

export function GamesViewControls({ sortBy, sortDir, layout, onSortChange, onLayoutChange }: GamesViewControlsProps) {
  // Construimos la clave activa del select
  const selectedKey = `${sortBy}_${sortDir}`;

  const handleSortSelect = (keys: unknown) => {
    // HeroUI devuelve un Set
    const key = typeof keys === "string" ? keys : Array.from(keys as Set<string>)[0];
    const option = SORT_OPTIONS.find((o) => o.key === key);
    if (option) {
      onSortChange(option.field, option.dir);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
      {/* Sort selector */}
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-sm text-default-500 hidden sm:inline">Ordenar por</span>
        <Select
          selectedKeys={new Set([selectedKey])}
          onSelectionChange={handleSortSelect}
          className="w-52"
          size="sm"
          variant="bordered"
          aria-label="Ordenar juegos por"
          classNames={{
            trigger: "border-default-200 dark:border-default-100",
          }}>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.key}>{opt.label}</SelectItem>
          ))}
        </Select>
      </div>

      {/* Divider */}
      <div className="hidden h-6 w-px bg-default-200 sm:block" />

      {/* Layout toggle */}
      <div className="flex items-center gap-1 rounded-xl border border-default-200 bg-default-50 p-1 dark:border-default-100 dark:bg-default-100/30">
        <LayoutButton value="grid-lg" current={layout} onClick={onLayoutChange} label="Tarjetas grandes">
          <LayoutGrid size={17} />
        </LayoutButton>
        <LayoutButton value="grid-md" current={layout} onClick={onLayoutChange} label="Tarjetas medianas">
          <Grid2X2 size={17} />
        </LayoutButton>
        <LayoutButton value="list" current={layout} onClick={onLayoutChange} label="Vista lista">
          <AlignJustify size={17} />
        </LayoutButton>
      </div>
    </div>
  );
}
