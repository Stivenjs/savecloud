import { memo } from "react";
import { Pagination, Button } from "@heroui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

type SteamCatalogPaginationProps = {
  totalPages: number;
  page: number;
  onChange: (page: number) => void;
  isDisabled?: boolean;
  consoleMode?: boolean;
};

export const SteamCatalogPagination = memo(function SteamCatalogPagination({
  totalPages,
  page,
  onChange,
  isDisabled,
  consoleMode = false,
}: SteamCatalogPaginationProps) {
  const { t } = useTranslation();
  if (totalPages <= 1) {
    return null;
  }

  if (consoleMode) {
    return (
      <nav
        className="flex items-center justify-center gap-6 pt-8 pb-4"
        aria-label={t("steamCatalog.pagination.ariaLabel")}>
        <Button
          size="lg"
          variant="flat"
          isDisabled={page <= 1 || isDisabled}
          className="h-12 px-6 text-base font-semibold rounded-xl bg-default-100/30 text-white hover:bg-default-100/50"
          startContent={<ChevronLeft size={20} />}
          onPress={() => onChange(page - 1)}>
          {t("steamCatalog.pagination.previous")}
        </Button>
        <span className="text-lg font-bold text-default-400 min-w-36 text-center tabular-nums">
          {t("steamCatalog.pageXofY", { page, total: totalPages })}
        </span>
        <Button
          size="lg"
          variant="flat"
          isDisabled={page >= totalPages || isDisabled}
          className="h-12 px-6 text-base font-semibold rounded-xl bg-default-100/30 text-white hover:bg-default-100/50"
          endContent={<ChevronRight size={20} />}
          onPress={() => onChange(page + 1)}>
          {t("steamCatalog.pagination.next")}
        </Button>
      </nav>
    );
  }

  return (
    <nav className="flex justify-center pt-6 pb-2" aria-label={t("steamCatalog.pagination.ariaLabel")}>
      <Pagination
        aria-label={t("steamCatalog.pagination.ariaLabel")}
        total={totalPages}
        page={page}
        onChange={onChange}
        showControls
        color="primary"
        variant="bordered"
        radius={consoleMode ? "lg" : "md"}
        size={consoleMode ? "lg" : "sm"}
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
