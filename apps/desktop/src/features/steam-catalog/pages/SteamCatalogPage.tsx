import { useNavigate } from "react-router-dom";
import { Spinner, Drawer, DrawerBody, DrawerContent, DrawerHeader, Button, cn } from "@heroui/react";
import { Library, SlidersHorizontal } from "lucide-react";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { SteamCatalogFilters } from "@features/steam-catalog/components/SteamCatalogFilters";
import { SteamCatalogGrid } from "@features/steam-catalog/components/SteamCatalogGrid";
import { SteamCatalogPagination } from "@features/steam-catalog/components/SteamCatalogPagination";
import { SteamCatalogTrendingHero } from "@features/steam-catalog/components/SteamCatalogTrendingHero";
import { SteamCatalogToolbar } from "@features/steam-catalog/components/SteamCatalogToolbar";
import { useSteamCatalogQueries } from "@features/steam-catalog/hooks/useSteamCatalogQueries";
import { useSteamCatalogTrendingHero } from "@features/steam-catalog/hooks/useSteamCatalogTrendingHero";
import { useShellUiStore } from "@store/ShellUiStore";
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";

export function SteamCatalogPage() {
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
    mediaBySteamAppId,
    matchByGameName,
    isMediaBatchPending,
    isMatchingPending,
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

  const isReady = !isLoading && items.length > 0;
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
    <div className="space-y-6">
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
              Catálogo Steam
            </h1>
            <p className="text-xs text-default-400 mt-0.5">
              {totalBrowse > 0 ? `${totalBrowse.toLocaleString()} juegos indexados` : ""}
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
              Filtrar
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
          {!bigPictureConsole && <SteamCatalogToolbar searchTerm={searchTerm} onSearchTermChange={setSearchTerm} />}

          {isLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <Spinner size="lg" color="primary" label="Cargando catálogo…" />
            </div>
          ) : isError ? (
            <p className="text-sm text-danger">{errorMsg?.message ?? "No se pudo cargar el catálogo."}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-default-500">
              {searchMode
                ? "Sin resultados para esa búsqueda."
                : totalBrowse === 0
                  ? "Aún no hay juegos listados. Ve a Configuración, revisa la clave de Steam y pulsa «Sincronizar catálogo ahora»."
                  : selectedGenres.length > 0 || selectedTags.length > 0
                    ? "Ningún juego cumple estos filtros. Prueba a quitar algunos o combinar con la búsqueda por nombre."
                    : "Sin resultados."}
            </p>
          ) : (
            <>
              <p className="text-xs text-default-500 tabular-nums">
                <span className="font-semibold text-default-700 dark:text-default-300">
                  {rangeStart}–{rangeEnd}
                </span>{" "}
                de{" "}
                <span className="font-semibold text-default-700 dark:text-default-300">
                  {totalForRange.toLocaleString()}
                </span>{" "}
                {totalForRange === 1 ? "resultado" : "resultados"}
              </p>

              {isMediaBatchPending ? (
                <div className="flex min-h-[40vh] items-center justify-center">
                  <Spinner size="lg" color="primary" label="Cargando portadas y datos de la tienda…" />
                </div>
              ) : (
                <>
                  {isMatchingPending ? (
                    <p className="text-xs text-default-400">Validando disponibilidad en tus fuentes...</p>
                  ) : null}
                  <div className="relative">
                    {isListRefetching ? (
                      <div
                        className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center rounded-large bg-background/60 pt-8 backdrop-blur-[1px]"
                        aria-busy="true"
                        aria-label="Actualizando listado">
                        <Spinner size="md" color="primary" />
                      </div>
                    ) : null}
                    <SteamCatalogGrid
                      items={items}
                      listKey={
                        searchMode
                          ? `search-${debouncedSearch}-${filterSignature}-p${page}`
                          : `browse-${filterSignature}-p${page}`
                      }
                      mediaBySteamAppId={mediaBySteamAppId}
                      matchByGameName={matchByGameName}
                      isMatchingPending={isMatchingPending}
                      consoleMode={bigPictureConsole}
                    />
                  </div>

                  <SteamCatalogPagination
                    totalPages={totalPages}
                    page={page}
                    onChange={setPage}
                    isDisabled={isPageTransition}
                    consoleMode={bigPictureConsole}
                  />
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
                    Filtrar catálogo
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
