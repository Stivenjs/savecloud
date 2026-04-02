import { memo, useCallback, useMemo, useState } from "react";
import { Accordion, AccordionItem, Button, Checkbox, Chip, Input, Skeleton } from "@heroui/react";
import type { CatalogFilterFacet } from "@services/tauri";
import { useDebouncedValue } from "@hooks/useDebouncedValue";

type SteamCatalogFiltersProps = {
  genres: CatalogFilterFacet[];
  tags: CatalogFilterFacet[];
  selectedGenres: string[];
  selectedTags: string[];
  onToggleGenre: (label: string) => void;
  onToggleTag: (label: string) => void;
  onClearAll: () => void;
  isLoading?: boolean;
};

function normalizeFilter(s: string): string {
  return s.trim().toLowerCase();
}

/** Panel de filtros con estado optimista: el checkbox se marca de inmediato
 *  sin esperar a que el padre propague el nuevo estado. */
const FacetFilterPanel = memo(function FacetFilterPanel({
  items,
  selected,
  onToggle,
  filterPlaceholder,
}: {
  items: CatalogFilterFacet[];
  selected: Set<string>;
  onToggle: (label: string) => void;
  filterPlaceholder: string;
}) {
  const [filterText, setFilterText] = useState("");
  const debouncedFilterText = useDebouncedValue(filterText, 300);
  const needle = normalizeFilter(debouncedFilterText);

  const [optimisticPending, setOptimisticPending] = useState<Map<string, boolean>>(new Map());

  const handleToggle = useCallback(
    (label: string) => {
      const currentValue = selected.has(label);
      setOptimisticPending((prev) => {
        const next = new Map(prev);
        next.set(label, !currentValue);
        return next;
      });

      onToggle(label);

      setTimeout(() => {
        setOptimisticPending((prev) => {
          const next = new Map(prev);
          next.delete(label);
          return next;
        });
      }, 300);
    },
    [selected, onToggle]
  );

  const filtered = useMemo(() => {
    if (!needle) return items;
    return items.filter((f) => f.label.toLowerCase().includes(needle));
  }, [items, needle]);

  const subtitle =
    needle.length > 0
      ? `${filtered.length} de ${items.length} visibles`
      : `${items.length} disponible${items.length === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-2 pt-1">
      <p className="text-xs text-default-500">{subtitle}</p>
      <Input
        size="sm"
        placeholder={filterPlaceholder}
        value={filterText}
        onValueChange={setFilterText}
        variant="bordered"
        classNames={{ input: "text-xs" }}
        aria-label="Filtrar lista"
      />
      <div className="max-h-60 overflow-y-auto rounded-medium border border-default-200/80 bg-default-50/30 px-2 py-2 dark:border-default-100/15 dark:bg-default-50/10">
        {filtered.length === 0 ? (
          <p className="px-1 py-2 text-center text-xs text-default-400">Sin coincidencias</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filtered.map((f) => {
              const isSelected = optimisticPending.has(f.label)
                ? optimisticPending.get(f.label)!
                : selected.has(f.label);

              return (
                <li key={f.label}>
                  <Checkbox
                    size="sm"
                    classNames={{ label: "w-full max-w-full text-xs" }}
                    isSelected={isSelected}
                    onValueChange={() => handleToggle(f.label)}>
                    <span className="flex w-full min-w-0 items-center justify-between gap-2">
                      <span className="truncate">{f.label}</span>
                      <span className="shrink-0 tabular-nums text-default-400">{f.count}</span>
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
}: SteamCatalogFiltersProps) {
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
      <div className="space-y-3 rounded-xl border border-default-200/80 bg-content1 p-4 dark:border-default-100/15">
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
    <div className="space-y-3 rounded-xl border border-default-200/80 bg-content1 p-3 shadow-sm dark:border-default-100/15">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-default-500">Filtros</p>
        {hasSelection ? (
          <Button
            size="sm"
            variant="light"
            color="warning"
            className="h-7 min-w-0 px-2 text-xs"
            onPress={handleClearAll}>
            Quitar filtros
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-default-500">
        Solo afectan a juegos con ficha descargada (géneros y etiquetas de la tienda Steam).
      </p>
      {!genres.length && !tags.length ? (
        <p className="text-xs text-default-400">
          Aún no hay datos para filtrar. Sincroniza el catálogo y abre algunas fichas para rellenar géneros y etiquetas.
        </p>
      ) : (
        <Accordion
          selectionMode="multiple"
          defaultExpandedKeys={defaultExpandedKeys}
          className="px-0"
          itemClasses={{
            base: "px-0",
            title: "text-sm",
            trigger: "py-2",
            content: "pb-2 pt-0",
          }}>
          {genres.length > 0 ? (
            <AccordionItem
              key="genres"
              aria-label="Géneros"
              title={
                <span className="flex w-full min-w-0 items-center gap-2 pr-1">
                  <span className="size-2 shrink-0 rounded-full bg-secondary" />
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">Géneros</span>
                  <Chip size="sm" variant="flat" className="shrink-0">
                    {genres.length}
                  </Chip>
                </span>
              }>
              <FacetFilterPanel
                items={genres}
                selected={genreSet}
                onToggle={handleToggleGenre}
                filterPlaceholder="Filtrar…"
              />
            </AccordionItem>
          ) : null}
          {tags.length > 0 ? (
            <AccordionItem
              key="tags"
              aria-label="Etiquetas"
              title={
                <span className="flex w-full min-w-0 items-center gap-2 pr-1">
                  <span className="size-2 shrink-0 rounded-full bg-success" />
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">Etiquetas</span>
                  <Chip size="sm" variant="flat" className="shrink-0">
                    {tags.length}
                  </Chip>
                </span>
              }>
              <FacetFilterPanel
                items={tags}
                selected={tagSet}
                onToggle={handleToggleTag}
                filterPlaceholder="Filtrar…"
              />
            </AccordionItem>
          ) : null}
        </Accordion>
      )}
    </div>
  );
}
