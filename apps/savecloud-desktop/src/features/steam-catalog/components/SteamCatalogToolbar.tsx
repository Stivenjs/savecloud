import { Input } from "@heroui/react";
import { Search } from "lucide-react";
import { STEAM_CATALOG_SEARCH_MIN } from "@features/steam-catalog/constants";

type SteamCatalogToolbarProps = {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
};

export function SteamCatalogToolbar({ searchTerm, onSearchTermChange }: SteamCatalogToolbarProps) {
  return (
    <Input
      aria-label="Buscar en catálogo"
      placeholder={`Varias palabras; no hace falta el título exacto (mín. ${STEAM_CATALOG_SEARCH_MIN} caracteres)…`}
      value={searchTerm}
      onValueChange={onSearchTermChange}
      startContent={<Search size={18} className="text-default-400" />}
      classNames={{ input: "text-sm" }}
      variant="bordered"
      isClearable
      onClear={() => onSearchTermChange("")}
    />
  );
}
