import { Input } from "@heroui/react";
import { Search } from "lucide-react";
import { STEAM_CATALOG_SEARCH_MIN } from "@/constants/constants";

type SteamCatalogToolbarProps = {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
};

export function SteamCatalogToolbar({ searchTerm, onSearchTermChange }: SteamCatalogToolbarProps) {
  return (
    <Input
      aria-label="Buscar en catálogo"
      placeholder={`Varias palabras; mín. ${STEAM_CATALOG_SEARCH_MIN} caracteres…`}
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
