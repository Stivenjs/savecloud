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
    <div className="flex flex-col items-center gap-2 pt-6 pb-2 cursor-pointer">
      <Pagination
        aria-label="Páginas del catálogo"
        total={totalPages}
        page={page}
        onChange={onChange}
        showControls
        showShadow
        color="primary"
        variant="bordered"
        size="sm"
        isDisabled={isDisabled}
        boundaries={1}
        siblings={1}
        classNames={{
          wrapper: "shadow-sm",
        }}
      />
    </div>
  );
});
