import { memo, useCallback, useMemo, useState } from "react";
import { Accordion, AccordionItem, Button, Checkbox, Chip, Input, Skeleton, cn } from "@heroui/react";
import type { CatalogFilterFacet } from "@services/tauri";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { Search, TagsIcon, Swords } from "lucide-react";
import { useTranslation } from "react-i18next";

type SteamCatalogFiltersProps = {
  genres: CatalogFilterFacet[];
  tags: CatalogFilterFacet[];
  selectedGenres: string[];
  selectedTags: string[];
  onToggleGenre: (label: string) => void;
  onToggleTag: (label: string) => void;
  onClearAll: () => void;
  isLoading?: boolean;
  consoleMode?: boolean;
};

function normalizeFilter(s: string): string {
  return s.trim().toLowerCase();
}

/** Panel de filtros con estado optimista: el checkbox se marca de inmediato
 * sin esperar a que el padre propague el nuevo estado. */
const FacetFilterPanel = memo(function FacetFilterPanel({
  items,
  selected,
  onToggle,
  filterPlaceholder,
  consoleMode = false,
}: {
  items: CatalogFilterFacet[];
  selected: Set<string>;
  onToggle: (label: string) => void;
  filterPlaceholder: string;
  consoleMode?: boolean;
}) {
  const { t } = useTranslation();
  const [filterText, setFilterText] = useState("");
  const debouncedFilterText = useDebouncedValue(filterText, 300);
  const needle = normalizeFilter(debouncedFilterText);

  const [optimisticPending, setOptimisticPending] = useState<Map<string, boolean>>(new Map());

  const handleToggle = useCallback(
    (label: string) => {
      setOptimisticPending((prev) => {
        const next = new Map(prev);
        const currentlySelected = prev.has(label) ? prev.get(label) : selected.has(label);
        next.set(label, !currentlySelected);
        return next;
      });

      onToggle(label);

      setTimeout(() => {
        setOptimisticPending((prev) => {
          const next = new Map(prev);
          next.delete(label);
          return next;
        });
      }, 800);
    },
    [selected, onToggle]
  );

  const filtered = useMemo(() => {
    if (!needle) return items;
    return items.filter((f) => f.label.toLowerCase().includes(needle));
  }, [items, needle]);

  const subtitle =
    needle.length > 0
      ? t("steamCatalog.filters.visibleOf", { filtered: filtered.length, total: items.length })
      : t("steamCatalog.filters.available", { count: items.length });

  return (
    <div className={cn("flex flex-col gap-3 pt-1", consoleMode && "gap-4")}>
      <div className="flex flex-col gap-2">
        <p className={cn("text-default-500", consoleMode ? "text-sm font-medium" : "text-xs")}>{subtitle}</p>
        <Input
          size={consoleMode ? "lg" : "sm"}
          placeholder={filterPlaceholder}
          value={filterText}
          startContent={<Search size={consoleMode ? 22 : 18} className="text-default-400" />}
          onValueChange={setFilterText}
          variant={consoleMode ? "flat" : "bordered"}
          classNames={{
            input: consoleMode ? "text-base font-medium" : "text-xs",
            inputWrapper: consoleMode ? "h-12 min-h-12 rounded-xl" : "h-8 min-h-8",
          }}
          aria-label={t("steamCatalog.filters.filterList")}
        />
      </div>

      <div className={cn("overflow-y-auto pr-2", consoleMode ? "max-h-[calc(100dvh-320px)]" : "max-h-64")}>
        {filtered.length === 0 ? (
          <p className={cn("text-center text-default-400", consoleMode ? "py-6 text-sm" : "py-4 text-xs")}>
            {t("steamCatalog.filters.noMatches")}
          </p>
        ) : (
          <ul className={cn("flex flex-col gap-1.5", consoleMode && "gap-3")}>
            {filtered.map((f) => {
              const isSelected = optimisticPending.has(f.label)
                ? optimisticPending.get(f.label)!
                : selected.has(f.label);

              return (
                <li key={f.label}>
                  <Checkbox
                    size={consoleMode ? "lg" : "sm"}
                    classNames={{
                      base: cn(
                        "max-w-full w-full p-1 -m-1 rounded-md hover:bg-default-100/50 transition-colors",
                        consoleMode
                          ? "p-3 rounded-xl min-h-12 bg-default-100/10 hover:bg-default-100/30"
                          : "p-1 -m-1 rounded-md"
                      ),
                      label: cn("w-full", consoleMode ? "text-base font-semibold" : "text-xs"),
                    }}
                    isSelected={isSelected}
                    onValueChange={() => handleToggle(f.label)}>
                    <span className="flex w-full min-w-0 items-center justify-between gap-2">
                      <span className="truncate">{f.label}</span>
                      <span
                        className={cn(
                          "shrink-0 tabular-nums text-default-400/80",
                          consoleMode ? "text-sm" : "text-[10px]"
                        )}>
                        {f.count}
                      </span>
                    </span>
                  </Checkbox>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
});

export function SteamCatalogFilters({
  genres,
  tags,
  selectedGenres,
  selectedTags,
  onToggleGenre,
  onToggleTag,
  onClearAll,
  isLoading,
  consoleMode = false,
}: SteamCatalogFiltersProps) {
  const { t } = useTranslation();
  const genreSet = useMemo(() => new Set(selectedGenres), [selectedGenres]);
  const tagSet = useMemo(() => new Set(selectedTags), [selectedTags]);
  const hasSelection = selectedGenres.length > 0 || selectedTags.length > 0;

  const handleToggleGenre = useCallback((label: string) => onToggleGenre(label), [onToggleGenre]);
  const handleToggleTag = useCallback((label: string) => onToggleTag(label), [onToggleTag]);
  const handleClearAll = useCallback(() => onClearAll(), [onClearAll]);

  const defaultExpandedKeys = useMemo(
    () => [genres.length > 0 ? "genres" : null, tags.length > 0 ? "tags" : null].filter(Boolean) as string[],
    [genres.length, tags.length]
  );

  if (isLoading) {
    return (
      <div
        className={cn(
          "space-y-3 rounded-xl border border-default-200/80 bg-content1 p-4 dark:border-default-100/15",
          consoleMode && "border-none bg-transparent p-1 shadow-none"
        )}>
        <Skeleton className="h-4 w-32 rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-4 w-28 rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border border-default-200/80 bg-content1 p-3 shadow-sm dark:border-default-100/15",
        consoleMode && "border-none bg-transparent p-1 shadow-none space-y-4"
      )}>
      <div
        className={cn(
          "flex items-center justify-between gap-2 pb-1 border-b border-default-200/60 dark:border-default-100/10",
          consoleMode && "pb-2"
        )}>
        <p
          className={cn(
            "font-bold uppercase tracking-widest text-default-400",
            consoleMode ? "text-xs" : "text-[11px]"
          )}>
          {t("steamCatalog.filters.title")}
        </p>
        {hasSelection ? (
          <Button
            size={consoleMode ? "md" : "sm"}
            variant="light"
            color="warning"
            className={cn("h-7 min-w-0 px-2 text-xs", consoleMode && "h-9 px-3 text-sm font-semibold rounded-xl")}
            onPress={handleClearAll}>
            <span className="flex items-center gap-1.5">
              <span
                className="flex size-4 items-center justify-center rounded-full 
                         bg-warning text-[10px] font-bold text-warning-foreground">
                {selectedGenres.length + selectedTags.length}
              </span>
              {t("steamCatalog.filters.clearButton")}
            </span>
          </Button>
        ) : null}
      </div>
      <p className={cn("text-default-500", consoleMode ? "text-sm font-medium" : "text-xs")}>
        {t("steamCatalog.filters.onlyAffects")}
      </p>
      {!genres.length && !tags.length ? (
        <p className={cn("text-default-400", consoleMode ? "text-sm" : "text-xs")}>
          {t("steamCatalog.filters.noDataYet")}
        </p>
      ) : (
        <Accordion
          selectionMode="multiple"
          defaultExpandedKeys={defaultExpandedKeys}
          className="px-0"
          itemClasses={{
            base: "px-0",
            title: cn("font-medium", consoleMode ? "text-base" : "text-sm"),
            trigger: consoleMode ? "py-4" : "py-2",
            content: consoleMode ? "pb-3 pt-0" : "pb-2 pt-0",
          }}>
          {genres.length > 0 ? (
            <AccordionItem
              key="genres"
              aria-label={t("steamCatalog.filters.genres")}
              title={
                <span className="flex w-full min-w-0 items-center gap-2 pr-1">
                  <Swords className={cn("shrink-0 text-secondary", consoleMode ? "size-5" : "size-4")} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-left font-semibold",
                      consoleMode ? "text-base" : "text-sm"
                    )}>
                    {t("steamCatalog.filters.genres")}
                  </span>
                  <Chip size={consoleMode ? "md" : "sm"} variant="flat" className="shrink-0">
                    {genres.length}
                  </Chip>
                </span>
              }>
              <FacetFilterPanel
                items={genres}
                selected={genreSet}
                onToggle={handleToggleGenre}
                filterPlaceholder={t("steamCatalog.filters.filterPlaceholder")}
                consoleMode={consoleMode}
              />
            </AccordionItem>
          ) : null}
          {tags.length > 0 ? (
            <AccordionItem
              key="tags"
              aria-label={t("steamCatalog.filters.tags")}
              title={
                <span className="flex w-full min-w-0 items-center gap-2 pr-1">
                  <TagsIcon className={cn("shrink-0 text-success", consoleMode ? "size-5" : "size-4")} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-left font-semibold",
                      consoleMode ? "text-base" : "text-sm"
                    )}>
                    {t("steamCatalog.filters.tags")}
                  </span>
                  <Chip size={consoleMode ? "md" : "sm"} variant="flat" className="shrink-0">
                    {tags.length}
                  </Chip>
                </span>
              }>
              <FacetFilterPanel
                items={tags}
                selected={tagSet}
                onToggle={handleToggleTag}
                filterPlaceholder={t("steamCatalog.filters.filterPlaceholder")}
                consoleMode={consoleMode}
              />
            </AccordionItem>
          ) : null}
        </Accordion>
      )}
    </div>
  );
}
