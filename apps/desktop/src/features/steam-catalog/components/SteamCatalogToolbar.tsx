import { Input } from "@heroui/react";
import { Search } from "lucide-react";
import { STEAM_CATALOG_SEARCH_MIN } from "@/constants/constants";
import { useTranslation } from "react-i18next";

type SteamCatalogToolbarProps = {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
};

export function SteamCatalogToolbar({ searchTerm, onSearchTermChange }: SteamCatalogToolbarProps) {
  const { t } = useTranslation();
  return (
    <Input
      aria-label={t("steamCatalog.searchAriaLabel")}
      placeholder={t("steamCatalog.searchPlaceholder", { min: STEAM_CATALOG_SEARCH_MIN })}
      value={searchTerm}
      onValueChange={onSearchTermChange}
      startContent={<Search size={18} className="text-default-400 transition-colors group-focus-within:text-primary" />}
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
  );
}
