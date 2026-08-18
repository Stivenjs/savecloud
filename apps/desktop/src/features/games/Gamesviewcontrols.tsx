/**
 * GamesViewControls
 * Barra de controles de visualización: ordenación (sort) + toggle de layout (grid-lg / grid-md / list).
 * Diseño coherente con el dark theme de la app (HeroUI + Tailwind).
 */

import { Select, SelectItem } from "@heroui/react";
import { LayoutGrid, Grid2X2, AlignJustify, RectangleVertical, RectangleHorizontal } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GamesCardOrientation, GamesLayout, GamesSortDir, GamesSortField } from "@hooks/useGamesViewPreferences";

interface SortOption {
  key: string;
  field: GamesSortField;
  dir: GamesSortDir;
  labelKey: string;
}

const SORT_OPTION_DEFS: SortOption[] = [
  { key: "title_asc", field: "title", dir: "asc", labelKey: "library.viewControls.sort.titleAsc" },
  { key: "title_desc", field: "title", dir: "desc", labelKey: "library.viewControls.sort.titleDesc" },
  { key: "lastModified_desc", field: "lastModified", dir: "desc", labelKey: "library.viewControls.sort.modifiedDesc" },
  { key: "lastModified_asc", field: "lastModified", dir: "asc", labelKey: "library.viewControls.sort.modifiedAsc" },
  { key: "playtime_desc", field: "playtime", dir: "desc", labelKey: "library.viewControls.sort.playtimeDesc" },
  { key: "playtime_asc", field: "playtime", dir: "asc", labelKey: "library.viewControls.sort.playtimeAsc" },
  { key: "size_desc", field: "size", dir: "desc", labelKey: "library.viewControls.sort.sizeDesc" },
  { key: "size_asc", field: "size", dir: "asc", labelKey: "library.viewControls.sort.sizeAsc" },
];

/** Estilos del listbox del Select en Big Picture (tipografía y altura de fila). */
const CONSOLE_SORT_LISTBOX_PROPS = {
  itemClasses: {
    base: "min-h-14 rounded-lg px-3 py-2 data-[hover=true]:bg-default-200/55 dark:data-[hover=true]:bg-default-100/25",
    title: "text-lg font-semibold leading-snug text-foreground sm:text-xl",
    wrapper: "py-1",
    selectedIcon: "text-primary [&_svg]:size-6",
  },
  classNames: {
    list: "gap-1 px-1 py-2",
    base: "p-0",
  },
} as const;

interface LayoutButtonProps {
  value: GamesLayout;
  current: GamesLayout;
  onClick: (v: GamesLayout) => void;
  label: string;
  children: React.ReactNode;
  consoleMode?: boolean;
}

function LayoutButton({ value, current, onClick, label, children, consoleMode = false }: LayoutButtonProps) {
  const isActive = current === value;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isActive}
      onClick={() => onClick(value)}
      className={[
        "flex items-center justify-center cursor-pointer rounded-lg transition-colors duration-150 tap-highlight-transparent outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        consoleMode ? "min-h-14 min-w-14 p-3.5 sm:min-h-15 sm:min-w-15" : "p-2",
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
  cardOrientation?: GamesCardOrientation;
  onSortChange: (field: GamesSortField, dir: GamesSortDir) => void;
  onLayoutChange: (layout: GamesLayout) => void;
  onCardOrientationChange?: (orientation: GamesCardOrientation) => void;
  /** Big Picture / mando: controles más altos y foco visible. */
  consoleMode?: boolean;
}

export function GamesViewControls({
  sortBy,
  sortDir,
  layout,
  cardOrientation = "vertical",
  onSortChange,
  onLayoutChange,
  onCardOrientationChange,
  consoleMode = false,
}: GamesViewControlsProps) {
  const { t } = useTranslation();
  const sortOptions = useMemo(() => SORT_OPTION_DEFS.map((opt) => ({ ...opt, label: t(opt.labelKey) })), [t]);

  const selectedKey = `${sortBy}_${sortDir}`;

  const handleSortSelect = (keys: unknown) => {
    const key = typeof keys === "string" ? keys : Array.from(keys as Set<string>)[0];
    const option = sortOptions.find((o) => o.key === key);
    if (option) {
      onSortChange(option.field, option.dir);
    }
  };

  const iconSize = consoleMode ? 26 : 17;

  return (
    <div
      className={[
        "flex flex-wrap items-center gap-3",
        consoleMode ? "w-full gap-4 sm:gap-5 sm:flex-nowrap sm:justify-end" : "sm:flex-nowrap",
      ].join(" ")}>
      <div className={`flex items-center gap-2 ${consoleMode ? "min-w-0 w-full sm:w-auto sm:flex-1 sm:max-w-md" : ""}`}>
        <span
          className={[
            "whitespace-nowrap text-default-500",
            consoleMode ? "inline text-lg font-semibold" : "hidden text-sm sm:inline",
          ].join(" ")}>
          {t("library.viewControls.sortBy")}
        </span>
        <Select
          selectedKeys={new Set([selectedKey])}
          onSelectionChange={handleSortSelect}
          className={consoleMode ? "min-w-0 flex-1 sm:min-w-72" : "w-52"}
          size={consoleMode ? "lg" : "sm"}
          variant="bordered"
          aria-label={t("library.viewControls.sortAriaLabel")}
          maxListboxHeight={consoleMode ? 520 : undefined}
          listboxProps={consoleMode ? { ...CONSOLE_SORT_LISTBOX_PROPS } : undefined}
          classNames={{
            trigger: [
              "border-default-200 dark:border-default-100",
              consoleMode
                ? "min-h-14 h-14 text-lg data-[focus=true]:ring-2 data-[focus=true]:ring-primary data-[focus=true]:ring-offset-2 data-[focus=true]:ring-offset-background sm:min-h-15 sm:h-15"
                : "",
            ]
              .filter(Boolean)
              .join(" "),
            value: consoleMode ? "text-lg" : undefined,
            listbox: consoleMode ? "gap-0 p-0 text-lg" : undefined,
            popoverContent: consoleMode ? "min-w-[var(--trigger-width)] p-2 text-lg" : undefined,
          }}>
          {sortOptions.map((opt) => (
            <SelectItem key={opt.key} textValue={opt.label}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      </div>

      <div
        className={[
          "w-px shrink-0 bg-default-200",
          consoleMode ? "block h-12 self-center sm:h-14" : "hidden h-6 sm:block",
        ].join(" ")}
        aria-hidden
      />

      <div
        className={[
          "flex items-center rounded-xl border border-default-200 bg-default-50 dark:border-default-100 dark:bg-default-100/30",
          consoleMode ? "gap-1 rounded-2xl p-2" : "gap-1 p-1",
        ].join(" ")}>
        <LayoutButton
          value="grid-lg"
          current={layout}
          onClick={onLayoutChange}
          label={t("library.viewControls.layoutLarge")}
          consoleMode={consoleMode}>
          <LayoutGrid size={iconSize} />
        </LayoutButton>
        <LayoutButton
          value="grid-md"
          current={layout}
          onClick={onLayoutChange}
          label={t("library.viewControls.layoutMedium")}
          consoleMode={consoleMode}>
          <Grid2X2 size={iconSize} />
        </LayoutButton>
        <LayoutButton
          value="list"
          current={layout}
          onClick={onLayoutChange}
          label={t("library.viewControls.layoutList")}
          consoleMode={consoleMode}>
          <AlignJustify size={iconSize} />
        </LayoutButton>
      </div>

      {onCardOrientationChange && (
        <>
          <div
            className={[
              "w-px shrink-0 bg-default-200",
              consoleMode ? "block h-12 self-center sm:h-14" : "hidden h-6 sm:block",
            ].join(" ")}
            aria-hidden
          />

          <div
            className={[
              "flex items-center rounded-xl border border-default-200 bg-default-50 dark:border-default-100 dark:bg-default-100/30",
              consoleMode ? "gap-1 rounded-2xl p-2" : "gap-1 p-1",
            ].join(" ")}>
            <button
              type="button"
              aria-label={t("library.viewControls.orientationVertical")}
              aria-pressed={cardOrientation === "vertical"}
              onClick={() => onCardOrientationChange("vertical")}
              className={[
                "flex items-center justify-center cursor-pointer rounded-lg transition-colors duration-150 tap-highlight-transparent outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                consoleMode ? "min-h-14 min-w-14 p-3.5 sm:min-h-15 sm:min-w-15" : "p-2",
                cardOrientation === "vertical"
                  ? "bg-default-200 text-foreground dark:bg-default-100"
                  : "text-default-400 hover:bg-default-100 hover:text-default-600 dark:hover:bg-default-50",
              ].join(" ")}>
              <RectangleVertical size={iconSize} />
            </button>
            <button
              type="button"
              aria-label={t("library.viewControls.orientationHorizontal")}
              aria-pressed={cardOrientation === "horizontal"}
              onClick={() => onCardOrientationChange("horizontal")}
              className={[
                "flex items-center justify-center cursor-pointer rounded-lg transition-colors duration-150 tap-highlight-transparent outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                consoleMode ? "min-h-14 min-w-14 p-3.5 sm:min-h-15 sm:min-w-15" : "p-2",
                cardOrientation === "horizontal"
                  ? "bg-default-200 text-foreground dark:bg-default-100"
                  : "text-default-400 hover:bg-default-100 hover:text-default-600 dark:hover:bg-default-50",
              ].join(" ")}>
              <RectangleHorizontal size={iconSize} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
