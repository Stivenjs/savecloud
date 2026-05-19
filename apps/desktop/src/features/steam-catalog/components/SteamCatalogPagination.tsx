import { memo } from "react";
import { Pagination } from "@heroui/react";

type SteamCatalogPaginationProps = {
  totalPages: number;
  page: number;
  onChange: (page: number) => void;
  isDisabled?: boolean;
};

export const SteamCatalogPagination = memo(function SteamCatalogPagination({
  totalPages,
  page,
  onChange,
  isDisabled,
}: SteamCatalogPaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav className="flex justify-center pt-6 pb-2" aria-label="Páginas del catálogo">
      <Pagination
        aria-label="Páginas del catálogo"
        total={totalPages}
        page={page}
        onChange={onChange}
        showControls
        color="primary"
        variant="bordered"
        radius="md"
        size="sm"
        isDisabled={isDisabled}
        boundaries={1}
        siblings={1}
        classNames={{
          base: "sg-catalog-pagination",
          wrapper: "sg-catalog-pagination__wrapper",
          item: "sg-catalog-pagination__item",
          cursor: "sg-catalog-pagination__active",
          prev: "sg-catalog-pagination__nav",
          next: "sg-catalog-pagination__nav",
        }}
      />
    </nav>
  );
});
