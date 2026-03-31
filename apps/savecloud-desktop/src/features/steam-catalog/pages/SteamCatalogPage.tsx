import { useNavigate } from "react-router-dom";
import { Spinner } from "@heroui/react";
import { Library } from "lucide-react";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { SteamCatalogFilters } from "@features/steam-catalog/components/SteamCatalogFilters";
import { SteamCatalogGrid } from "@features/steam-catalog/components/SteamCatalogGrid";
import { SteamCatalogPagination } from "@features/steam-catalog/components/SteamCatalogPagination";
import { SteamCatalogToolbar } from "@features/steam-catalog/components/SteamCatalogToolbar";
import { useSteamCatalogQueries } from "@features/steam-catalog/hooks/useSteamCatalogQueries";
import { useQuery } from "@tanstack/react-query";
import { getDefaultSourceDownloadDir } from "@services/tauri";

export function SteamCatalogPage() {
  const navigate = useNavigate();
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
    facets,
    facetsLoading,
    selectedGenres,
    selectedTags,
    toggleGenre,
    toggleTag,
    clearFilters,
  } = useSteamCatalogQueries();
  const { data: defaultSourceDownloadDir } = useQuery({
    queryKey: ["default-source-download-dir"],
    queryFn: getDefaultSourceDownloadDir,
  });

  useRegisterGlobalBack(() => {
    navigate("/");
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Library size={22} className="text-primary" />
          <h1 className="text-2xl font-semibold">Catálogo Steam</h1>
        </div>
        <p className="mt-1 text-sm text-default-500">
          Explora el catálogo local: al abrir esta pantalla se actualiza un orden de tendencia aproximado según las
          listas públicas de la tienda Steam (más vendidos, ofertas y novedades); el resto va por ID de app. Pulsa un
          juego para ver su ficha. Si no ves datos, ve a Configuración, revisa la clave de Steam y pulsa «Sincronizar
          catálogo ahora».
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-5rem)] lg:w-80 lg:overflow-y-auto lg:pr-1">
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
              <p className="text-xs text-default-500">
                {searchMode ? (
                  <>
                    Página {page} de {totalPages} · {rangeStart}–{rangeEnd} de {totalForRange}{" "}
                    {totalForRange === 1 ? "resultado" : "resultados"}
                  </>
                ) : (
                  <>
                    Página {page} de {totalPages} · {rangeStart}–{rangeEnd} de {totalForRange}
                  </>
                )}
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
                  <SteamCatalogGrid
                    items={items}
                    listKey={
                      searchMode
                        ? `search-${debouncedSearch}-${filterSignature}-p${page}`
                        : `browse-${filterSignature}-p${page}`
                    }
                    mediaBySteamAppId={mediaBySteamAppId}
                    matchByGameName={matchByGameName}
                    defaultDownloadDir={defaultSourceDownloadDir ?? ""}
                  />

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
