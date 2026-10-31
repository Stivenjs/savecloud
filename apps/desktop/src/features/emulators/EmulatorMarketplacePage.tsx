import { useMemo, useState } from "react";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import {
  EmulatorCatalogEmptyState,
  EmulatorCatalogError,
  EmulatorCatalogSkeleton,
} from "./components/EmulatorCatalogStates";
import { EmulatorCatalogGrid } from "./components/EmulatorCatalogGrid";
import { EmulatorCatalogHeader } from "./components/EmulatorCatalogHeader";
import { emulatorCatalog } from "./data/emulatorCatalog";
import { useEmulatorActions } from "./hooks/useEmulatorActions";
import { useEmulatorStatuses } from "./hooks/useEmulatorStatuses";

/** Orquesta búsqueda, estado nativo y componentes del catálogo de emuladores. */
export function EmulatorMarketplacePage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const { statuses, isLoading, isError, error, refetch, progresses, setProgresses, refreshStatus } =
    useEmulatorStatuses();
  const { install, pickExecutable, openExternal } = useEmulatorActions({ setProgresses, refreshStatus });

  const filteredCatalog = useMemo(() => {
    const normalizedSearch = debouncedSearch.trim().toLocaleLowerCase();
    if (!normalizedSearch) return emulatorCatalog;

    return emulatorCatalog.filter(
      (emulator) =>
        [emulator.name, emulator.console, emulator.developer, emulator.license, ...emulator.supportedPlatforms].some(
          (value) => value.toLocaleLowerCase().includes(normalizedSearch)
        ) ||
        emulator.description.es.toLocaleLowerCase().includes(normalizedSearch) ||
        emulator.description.en.toLocaleLowerCase().includes(normalizedSearch)
    );
  }, [debouncedSearch]);

  const installedCount = emulatorCatalog.filter((emulator) => statuses[emulator.id]?.installed).length;

  return (
    <div className="space-y-5 pb-3">
      <EmulatorCatalogHeader
        emulatorCount={emulatorCatalog.length}
        installedCount={installedCount}
        isLoading={isLoading}
        search={search}
        onSearchChange={setSearch}
      />

      {isError && <EmulatorCatalogError error={error} onRetry={() => void refetch()} />}

      {isLoading ? (
        <EmulatorCatalogSkeleton />
      ) : filteredCatalog.length === 0 ? (
        <EmulatorCatalogEmptyState />
      ) : (
        <EmulatorCatalogGrid
          emulators={filteredCatalog}
          statuses={statuses}
          progresses={progresses}
          statusUnavailable={isError}
          onInstall={(emulatorId) => void install(emulatorId)}
          onPickExecutable={(emulatorId, emulatorName) => void pickExecutable(emulatorId, emulatorName)}
          onOpenUrl={(url) => void openExternal(url)}
        />
      )}
    </div>
  );
}
