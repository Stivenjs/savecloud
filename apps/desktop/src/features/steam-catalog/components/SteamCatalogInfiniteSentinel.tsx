import { useEffect, useRef } from "react";
import { Spinner } from "@heroui/react";
import { useTranslation } from "react-i18next";

type SteamCatalogInfiniteSentinelProps = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onFetchNextPage: () => void;
};

export function SteamCatalogInfiniteSentinel({
  hasNextPage,
  isFetchingNextPage,
  onFetchNextPage,
}: SteamCatalogInfiniteSentinelProps) {
  const { t } = useTranslation();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting) {
          onFetchNextPage();
        }
      },
      { rootMargin: "1500px" }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, onFetchNextPage]);

  if (!hasNextPage) {
    return (
      <div className="py-8 text-center text-xs text-default-400">
        <span>{t("steamCatalog.infiniteScrollEnd", "Has alcanzado el final del catálogo.")}</span>
      </div>
    );
  }

  return (
    <div ref={sentinelRef} className="flex h-16 items-center justify-center py-2">
      {isFetchingNextPage ? (
        <Spinner size="md" color="primary" label={t("steamCatalog.loadingMore", "Cargando más juegos...")} />
      ) : null}
    </div>
  );
}
