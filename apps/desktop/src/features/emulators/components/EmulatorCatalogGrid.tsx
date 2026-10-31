import { EmulatorCatalogCard } from "./EmulatorCatalogCard";
import type { EmulatorCatalogEntry, EmulatorProgressById, EmulatorStatuses } from "../types/emulatorCatalog";

interface EmulatorCatalogGridProps {
  emulators: readonly EmulatorCatalogEntry[];
  statuses: EmulatorStatuses;
  progresses: EmulatorProgressById;
  statusUnavailable: boolean;
  onInstall: (emulatorId: string) => void;
  onPickExecutable: (emulatorId: string, emulatorName: string) => void;
  onOpenUrl: (url: string) => void;
}

/** Organiza las fichas del catálogo en una cuadrícula adaptable. */
export function EmulatorCatalogGrid({
  emulators,
  statuses,
  progresses,
  statusUnavailable,
  onInstall,
  onPickExecutable,
  onOpenUrl,
}: EmulatorCatalogGridProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {emulators.map((emulator) => (
        <EmulatorCatalogCard
          key={emulator.id}
          emulator={emulator}
          status={statuses[emulator.id]}
          progress={progresses[emulator.id]}
          statusUnavailable={statusUnavailable}
          onInstall={onInstall}
          onPickExecutable={onPickExecutable}
          onOpenUrl={onOpenUrl}
        />
      ))}
    </div>
  );
}
