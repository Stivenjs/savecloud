import { Input, Select, SelectItem } from "@heroui/react";
import { ArrowUpDown, Search } from "lucide-react";
import { STEAM_CATALOG_SEARCH_MIN } from "@/constants/constants";
import { useTranslation } from "react-i18next";

export type CatalogSortOption = "trending" | "title_asc" | "title_desc" | "newest";

type SteamCatalogToolbarProps = {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  sortOption: CatalogSortOption;
  onSortOptionChange: (option: CatalogSortOption) => void;
};

export function SteamCatalogToolbar({
  searchTerm,
  onSearchTermChange,
  sortOption,
  onSortOptionChange,
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

      <div className="w-full shrink-0 sm:w-64">
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
    </div>
  );
}
