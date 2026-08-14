import { useNavigate } from "react-router-dom";
import { Spinner, Drawer, DrawerBody, DrawerContent, DrawerHeader, Button, cn } from "@heroui/react";
import { Library, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { SteamCatalogFilters } from "@features/steam-catalog/components/SteamCatalogFilters";
import { SteamCatalogGrid } from "@features/steam-catalog/components/SteamCatalogGrid";
import { SteamCatalogPagination } from "@features/steam-catalog/components/SteamCatalogPagination";
import { SteamCatalogTrendingHero } from "@features/steam-catalog/components/SteamCatalogTrendingHero";
import {
  SteamCatalogToolbar,
  type CatalogPaginationMode,
} from "@features/steam-catalog/components/SteamCatalogToolbar";
import { SteamCatalogInfiniteSentinel } from "@features/steam-catalog/components/SteamCatalogInfiniteSentinel";
import { useSteamCatalogQueries } from "@features/steam-catalog/hooks/useSteamCatalogQueries";
import { useSteamCatalogInfiniteQuery } from "@features/steam-catalog/hooks/useSteamCatalogInfiniteQuery";
import { useSteamCatalogMediaAndMatches } from "@features/steam-catalog/hooks/useSteamCatalogMediaAndMatches";
import { useSteamCatalogTrendingHero } from "@features/steam-catalog/hooks/useSteamCatalogTrendingHero";
import { useSteamCatalogGamepadPagination } from "@features/steam-catalog/hooks/useSteamCatalogGamepadPagination";
import { useShellUiStore } from "@store/ShellUiStore";
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";

export function SteamCatalogPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const catalogScrollPosition = useShellUiStore((state) => state.catalogScrollPosition);
  const setCatalogScrollPosition = useShellUiStore((state) => state.setCatalogScrollPosition);

  const hasRestored = useRef(false);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

  const bigPictureConsole = useMemo(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("savecloud-big-picture"),
    []
  );

  const {
    searchTerm,
    setSearchTerm,
    sortOption,
    setSortOption,
    debouncedSearch,
    searchMode,
    filterSignature,
    page,
    setPage,
    totalPages,
    rangeStart,
    rangeEnd,
    totalForRange,
    items,
    totalBrowse,
    isLoading,
    isError,
    errorMsg,
    isPageTransition,
    isListRefetching,
    facets,
    facetsLoading,
    selectedGenres,
    selectedTags,
    toggleGenre,
    toggleTag,
    clearFilters,
  } = useSteamCatalogQueries();

  const [paginationMode, setPaginationMode] = useState<CatalogPaginationMode>("infinite");
  const isInfiniteMode = paginationMode === "infinite" && !bigPictureConsole;

  const pageSize = bigPictureConsole ? 25 : 24;

  const infiniteQuery = useSteamCatalogInfiniteQuery({
    pageSize,
    selectedGenres,
    selectedTags,
    searchMode,
    debouncedSearch,
    sortOption,
    trendingReady: true,
  });

  const activeItems = isInfiniteMode ? infiniteQuery.items : items;
  const activeIsLoading = isInfiniteMode ? infiniteQuery.isLoading : isLoading;
  const activeTotalForRange = isInfiniteMode ? infiniteQuery.totalCount : totalForRange;

  const {
    mediaBySteamAppId: activeMediaBySteamAppId,
    isMediaBatchPending: activeIsMediaBatchPending,
    matchByGameName: activeMatchByGameName,
    isMatchingPending: activeIsMatchingPending,
  } = useSteamCatalogMediaAndMatches(activeItems, pageSize);

  useRegisterGlobalBack(() => {
    navigate("/");
    return true;
  });

  useEffect(() => {
    if (!bigPictureConsole) return;
    const reg = useShellUiStore.getState().registerCatalogBpSearchValueSetter;
    const put = useShellUiStore.getState().setCatalogBpSearchTerm;
    reg(setSearchTerm);
    put(searchTerm);
    return () => {
      reg(null);
      put("");
    };
  }, [bigPictureConsole, setSearchTerm, searchTerm]);

  useEffect(() => {
    if (bigPictureConsole) useShellUiStore.getState().setCatalogBpSearchTerm(searchTerm);
  }, [bigPictureConsole, searchTerm]);

  const { triggerLabels, triggerUrls } = useSteamCatalogGamepadPagination({
    bigPictureConsole,
    totalPages,
    setPage,
  });

  const isReady = !activeIsLoading && activeItems.length > 0;
  const showTrendingHero = true;

  const {
    items: heroItems,
    mediaBySteamAppId: heroMediaBySteamAppId,
    isLoading: isHeroLoading,
    isFetching: isHeroFetching,
    isError: isHeroError,
    error: heroError,
  } = useSteamCatalogTrendingHero(showTrendingHero);

  useLayoutEffect(() => {
    if (!isReady || hasRestored.current) return;

    requestAnimationFrame(() => {
      window.scrollTo({ top: catalogScrollPosition, behavior: "instant" });
      hasRestored.current = true;
    });
  }, [isReady, catalogScrollPosition]);

  useEffect(() => {
    let scrollTimeout: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      if (!isReady || !hasRestored.current) return;

      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const currentY = window.scrollY || document.documentElement.scrollTop;
        setCatalogScrollPosition(currentY);
      }, 150);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [isReady, setCatalogScrollPosition]);

  const totalSelectedFilters = selectedGenres.length + selectedTags.length;

  return (
    <div className={cn("space-y-6", bigPictureConsole ? "pb-32" : "")}>
      <div className={cn("flex flex-wrap items-center justify-between gap-4", bigPictureConsole ? "mt-4 sm:mt-6" : "")}>
        <div className="flex items-center gap-3">
          {!bigPictureConsole && (
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 dark:bg-primary/15">
              <Library size={20} className="text-primary" />
            </div>
          )}
          <div>
            <h1
              className={cn(
                "font-bold tracking-tight text-foreground",
                bigPictureConsole ? "text-2xl md:text-[1.875rem]" : "text-2xl"
              )}>
              {t("steamCatalog.title")}
            </h1>
            <p className="text-xs text-default-400 mt-0.5">
              {activeTotalForRange > 0 ? t("steamCatalog.indexedGames", { count: activeTotalForRange }) : ""}
            </p>
          </div>
        </div>

        {bigPictureConsole && (
          <div className="flex items-center gap-3">
            <Button
              size="lg"
              variant="flat"
              color="default"
              className="font-semibold px-5 h-12 rounded-xl text-base bg-default-100/30 hover:bg-default-100/50"
              startContent={<SlidersHorizontal size={19} />}
              onPress={() => setIsFilterDrawerOpen(true)}>
              {t("steamCatalog.filterButton")}
              {totalSelectedFilters > 0 && (
                <span className="ml-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {totalSelectedFilters}
                </span>
              )}
            </Button>
          </div>
        )}
      </div>

      {showTrendingHero ? (
        <SteamCatalogTrendingHero
          items={heroItems}
          mediaBySteamAppId={heroMediaBySteamAppId}
          isLoading={isHeroLoading}
          isFetching={isHeroFetching}
          isError={isHeroError}
          errorMessage={heroError?.message}
        />
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {!bigPictureConsole && (
          <aside className="w-full shrink-0 lg:sticky lg:top-26 lg:max-h-[calc(100vh-8rem)] lg:w-80 lg:overflow-y-auto lg:pr-1">
            <SteamCatalogFilters
              genres={facets?.genres ?? []}
              tags={facets?.tags ?? []}
              selectedGenres={selectedGenres}
              selectedTags={selectedTags}
              onToggleGenre={toggleGenre}
              onToggleTag={toggleTag}
              onClearAll={clearFilters}
              isLoading={facetsLoading}
            />
          </aside>
        )}

        <div className="min-w-0 flex-1 space-y-4">
          {!bigPictureConsole && (
            <SteamCatalogToolbar
              searchTerm={searchTerm}
              onSearchTermChange={setSearchTerm}
              sortOption={sortOption}
              onSortOptionChange={setSortOption}
              paginationMode={paginationMode}
              onPaginationModeChange={setPaginationMode}
            />
          )}

          {activeIsLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <Spinner size="lg" color="primary" label={t("steamCatalog.loadingCatalog")} />
            </div>
          ) : isError ? (
            <p className="text-sm text-danger">{errorMsg?.message ?? t("steamCatalog.errorLoading")}</p>
          ) : activeItems.length === 0 ? (
            <p className="text-sm text-default-500">
              {searchMode
                ? t("steamCatalog.noSearchResults")
                : totalBrowse === 0
                  ? t("steamCatalog.noGamesListed")
                  : selectedGenres.length > 0 || selectedTags.length > 0
                    ? t("steamCatalog.noFilterResults")
                    : t("steamCatalog.noResults")}
            </p>
          ) : (
            <>
              <p className="text-xs text-default-500 tabular-nums">
                {isInfiniteMode ? (
                  <>
                    <span className="font-semibold text-default-700 dark:text-default-300">1–{activeItems.length}</span>{" "}
                    {t("steamCatalog.rangeOf")}{" "}
                    <span className="font-semibold text-default-700 dark:text-default-300">
                      {activeTotalForRange.toLocaleString()}
                    </span>{" "}
                    {t("steamCatalog.result", { count: activeTotalForRange })}
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-default-700 dark:text-default-300">
                      {rangeStart}–{rangeEnd}
                    </span>{" "}
                    {t("steamCatalog.rangeOf")}{" "}
                    <span className="font-semibold text-default-700 dark:text-default-300">
                      {totalForRange.toLocaleString()}
                    </span>{" "}
                    {t("steamCatalog.result", { count: totalForRange })}
                  </>
                )}
              </p>

              {activeIsMediaBatchPending ? (
                <div className="flex min-h-[40vh] items-center justify-center">
                  <Spinner size="lg" color="primary" label={t("steamCatalog.loadingCovers")} />
                </div>
              ) : (
                <>
                  {activeIsMatchingPending ? (
                    <p className="text-xs text-default-400">{t("steamCatalog.validatingSources")}</p>
                  ) : null}
                  <div className="relative">
                    {isListRefetching ? (
                      <div
                        className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center rounded-large bg-background/60 pt-8 backdrop-blur-[1px]"
                        aria-busy="true"
                        aria-label={t("steamCatalog.updatingList")}>
                        <Spinner size="md" color="primary" />
                      </div>
                    ) : null}
                    <SteamCatalogGrid
                      items={activeItems}
                      listKey={
                        isInfiniteMode
                          ? `infinite-${filterSignature}-${sortOption}`
                          : searchMode
                            ? `search-${debouncedSearch}-${filterSignature}-p${page}`
                            : `browse-${filterSignature}-p${page}`
                      }
                      mediaBySteamAppId={activeMediaBySteamAppId}
                      matchByGameName={activeMatchByGameName}
                      isMatchingPending={activeIsMatchingPending}
                      consoleMode={bigPictureConsole}
                    />
                  </div>

                  {isInfiniteMode ? (
                    <SteamCatalogInfiniteSentinel
                      hasNextPage={infiniteQuery.hasNextPage}
                      isFetchingNextPage={infiniteQuery.isFetchingNextPage}
                      onFetchNextPage={infiniteQuery.fetchNextPage}
                    />
                  ) : bigPictureConsole ? (
                    <div className="flex items-center justify-center gap-10 pt-10 pb-4 text-white/80 font-bold text-xl md:text-2xl select-none">
                      <span className="flex items-center gap-3">
                        {triggerUrls.left ? (
                          <img
                            src={triggerUrls.left}
                            alt={triggerLabels.left}
                            className="size-11 object-contain brightness-100 filter invert dark:invert-0 transition-transform active:scale-90"
                          />
                        ) : (
                          <span className="text-sm bg-default-100/50 px-3 py-1 rounded font-bold text-default-600 border border-default-200/60">
                            {triggerLabels.left}
                          </span>
                        )}
                      </span>
                      <span className="tracking-wide">{t("steamCatalog.pageXofY", { page, total: totalPages })}</span>
                      <span className="flex items-center gap-3">
                        {triggerUrls.right ? (
                          <img
                            src={triggerUrls.right}
                            alt={triggerLabels.right}
                            className="size-11 object-contain brightness-100 filter invert dark:invert-0 transition-transform active:scale-90"
                          />
                        ) : (
                          <span className="text-sm bg-default-100/50 px-3 py-1 rounded font-bold text-default-600 border border-default-200/60">
                            {triggerLabels.right}
                          </span>
                        )}
                      </span>
                    </div>
                  ) : (
                    <SteamCatalogPagination
                      totalPages={totalPages}
                      page={page}
                      onChange={setPage}
                      isDisabled={isPageTransition}
                      consoleMode={bigPictureConsole}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {bigPictureConsole && (
        <Drawer
          isOpen={isFilterDrawerOpen}
          onOpenChange={setIsFilterDrawerOpen}
          placement="left"
          size="md"
          classNames={{
            base: "bg-[#0e0f14]/95 backdrop-blur-2xl border-l border-white/[0.09] shadow-2xl text-foreground",
            header: "border-b border-white/[0.06] pb-4 px-6 pt-6",
            body: "py-6 px-6 overflow-y-auto",
          }}>
          <DrawerContent>
            {() => (
              <>
                <DrawerHeader className="flex flex-col gap-1">
                  <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                    <SlidersHorizontal size={20} className="text-primary" />
                    {t("steamCatalog.filterDrawerTitle")}
                  </h2>
                </DrawerHeader>
                <DrawerBody>
                  <SteamCatalogFilters
                    genres={facets?.genres ?? []}
                    tags={facets?.tags ?? []}
                    selectedGenres={selectedGenres}
                    selectedTags={selectedTags}
                    onToggleGenre={toggleGenre}
                    onToggleTag={toggleTag}
                    onClearAll={clearFilters}
                    isLoading={facetsLoading}
                    consoleMode={true}
                  />
                </DrawerBody>
              </>
            )}
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
