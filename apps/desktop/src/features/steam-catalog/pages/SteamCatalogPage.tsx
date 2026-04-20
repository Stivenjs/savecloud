import { useNavigate } from "react-router-dom";
import { Spinner } from "@heroui/react";
import { Library } from "lucide-react";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { SteamCatalogFilters } from "@features/steam-catalog/components/SteamCatalogFilters";
import { SteamCatalogGrid } from "@features/steam-catalog/components/SteamCatalogGrid";
import { SteamCatalogPagination } from "@features/steam-catalog/components/SteamCatalogPagination";
import { SteamCatalogTrendingHero } from "@features/steam-catalog/components/SteamCatalogTrendingHero";
import { SteamCatalogToolbar } from "@features/steam-catalog/components/SteamCatalogToolbar";
import { useSteamCatalogQueries } from "@features/steam-catalog/hooks/useSteamCatalogQueries";
import { useSteamCatalogTrendingHero } from "@features/steam-catalog/hooks/useSteamCatalogTrendingHero";
import { useShellUiStore } from "@store/ShellUiStore";
import { useEffect, useLayoutEffect, useRef } from "react";

export function SteamCatalogPage() {
  const navigate = useNavigate();

  const catalogScrollPosition = useShellUiStore((state) => state.catalogScrollPosition);
  const setCatalogScrollPosition = useShellUiStore((state) => state.setCatalogScrollPosition);

  const hasRestored = useRef(false);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div
          className="flex size-9 items-center justify-center rounded-xl 
                  bg-primary/10 dark:bg-primary/15">
          <Library size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Catálogo Steam</h1>
          <p className="text-xs text-default-400 mt-0.5">
            {totalBrowse > 0 ? `${totalBrowse.toLocaleString()} juegos indexados` : ""}
          </p>
        </div>
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

        <div className="min-w-0 flex-1 space-y-4">
          <SteamCatalogToolbar searchTerm={searchTerm} onSearchTermChange={setSearchTerm} />

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
                <span className="mx-2 text-default-300">·</span>
                Página {page}/{totalPages}
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
                    />
                  </div>

                  <SteamCatalogPagination
                    totalPages={totalPages}
                    page={page}
                    onChange={setPage}
                    isDisabled={isPageTransition}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
