import { Button, Input, Select, SelectItem, Tooltip } from "@heroui/react";
import { ArrowUpDown, Infinity as InfinityIcon, ListOrdered, Search } from "lucide-react";
import { STEAM_CATALOG_SEARCH_MIN } from "@/constants/constants";
import { useTranslation } from "react-i18next";

export type CatalogSortOption = "trending" | "title_asc" | "title_desc" | "newest";
export type CatalogPaginationMode = "infinite" | "paginated";

type SteamCatalogToolbarProps = {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  sortOption: CatalogSortOption;
  onSortOptionChange: (option: CatalogSortOption) => void;
  paginationMode?: CatalogPaginationMode;
  onPaginationModeChange?: (mode: CatalogPaginationMode) => void;
};

export function SteamCatalogToolbar({
  searchTerm,
  onSearchTermChange,
  sortOption,
  onSortOptionChange,
  paginationMode = "infinite",
  onPaginationModeChange,
}: SteamCatalogToolbarProps) {
  const { t } = useTranslation();

  const sortOptions: { key: CatalogSortOption; label: string }[] = [
    { key: "trending", label: t("steamCatalog.sort.trending") },
    { key: "title_asc", label: t("steamCatalog.sort.titleAsc") },
    { key: "title_desc", label: t("steamCatalog.sort.titleDesc") },
    { key: "newest", label: t("steamCatalog.sort.newest") },
  ];

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-1 min-w-0">
        <Input
          aria-label={t("steamCatalog.searchAriaLabel")}
          placeholder={t("steamCatalog.searchPlaceholder", { min: STEAM_CATALOG_SEARCH_MIN })}
          value={searchTerm}
          onValueChange={onSearchTermChange}
          startContent={
            <Search size={18} className="text-default-400 transition-colors group-focus-within:text-primary" />
          }
          classNames={{
            input: "text-sm",
            inputWrapper: `
              h-11 shadow-sm 
              transition-all duration-200
              hover:border-default-400 
              focus-within:border-primary focus-within:shadow-md focus-within:shadow-primary/10
            `,
          }}
          variant="bordered"
          isClearable
          onClear={() => onSearchTermChange("")}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="w-full shrink-0 sm:w-60">
          <Select
            aria-label={t("steamCatalog.sort.label")}
            selectedKeys={[sortOption]}
            onSelectionChange={(keys) => {
              const selected = Array.from(keys)[0] as CatalogSortOption | undefined;
              if (selected) {
                onSortOptionChange(selected);
              }
            }}
            startContent={<ArrowUpDown size={16} className="text-default-400 shrink-0" />}
            classNames={{
              trigger: "h-11 shadow-sm transition-all duration-200 hover:border-default-400",
              value: "text-sm font-medium",
            }}
            variant="bordered"
            disallowEmptySelection>
            {sortOptions.map((opt) => (
              <SelectItem key={opt.key}>{opt.label}</SelectItem>
            ))}
          </Select>
        </div>

        {onPaginationModeChange && (
          <div className="flex items-center gap-1 rounded-xl border border-default-200/70 bg-default-100/30 p-1 dark:border-default-100/15 dark:bg-default-50/10 shrink-0">
            <Tooltip content={t("steamCatalog.modeInfinite", "Scroll infinito")}>
              <Button
                isIconOnly
                size="sm"
                variant={paginationMode === "infinite" ? "solid" : "light"}
                color={paginationMode === "infinite" ? "primary" : "default"}
                onPress={() => onPaginationModeChange("infinite")}
                className="size-9 rounded-lg">
                <InfinityIcon size={18} />
              </Button>
            </Tooltip>
            <Tooltip content={t("steamCatalog.modePaginated", "Páginas numeradas")}>
              <Button
                isIconOnly
                size="sm"
                variant={paginationMode === "paginated" ? "solid" : "light"}
                color={paginationMode === "paginated" ? "primary" : "default"}
                onPress={() => onPaginationModeChange("paginated")}
                className="size-9 rounded-lg">
                <ListOrdered size={18} />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}
