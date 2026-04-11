import { lazy, useMemo, useState, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@heroui/react";
import { FolderOpen, Plus, Search, HardDrive, Gamepad2, MoreVertical, EyeOff, Trash2 } from "lucide-react";
import { scanPathCandidates } from "@services/tauri";
import type { PathCandidate } from "@services/tauri";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { useResolvedCandidateNames } from "@hooks/useResolvedCandidateNames";
import { useDismissedCandidates } from "@hooks/useDismissedCandidates";
import { extractAppIdFromFolderName, toGameId } from "@utils/gameImage";
import { useNavigable } from "@features/input/useNavigable";
import { getGamepadFocusClass } from "@features/input/styles";

const MagicRings = lazy(() => import("@components/external/MagicRings"));

interface ScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCandidate: (paths: string[], suggestedId: string) => void;
}

function CandidateMenu({ onDismiss }: { onDismiss: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover isOpen={open} onOpenChange={setOpen} placement="bottom-end" offset={4}>
      <PopoverTrigger>
        <Button
          isIconOnly
          size="sm"
          variant="light"
          aria-label="Más opciones"
          className="text-default-400 hover:text-default-600 shrink-0"
          onPress={() => setOpen((v) => !v)}>
          <MoreVertical size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-1 min-w-[200px]">
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-default-700 hover:bg-default-100 transition-colors text-left"
          onClick={() => {
            onDismiss();
            setOpen(false);
          }}>
          <EyeOff size={15} className="text-default-400 shrink-0" />
          <div>
            <p className="font-medium leading-tight">No es un juego</p>
            <p className="text-xs text-default-400 leading-tight mt-0.5">No volver a mostrar esto</p>
          </div>
        </button>
      </PopoverContent>
    </Popover>
  );
}

function CandidateRow({
  candidate,
  resolvedName,
  onAdd,
  onDismiss,
  index,
}: {
  candidate: PathCandidate;
  resolvedName: string | null | undefined;
  onAdd: () => void;
  onDismiss: () => void;
  index: number;
}) {
  const hasAppId = !!candidate.steamAppId || !!extractAppIdFromFolderName(candidate.folderName ?? "");
  const displayName = hasAppId && resolvedName ? resolvedName : candidate.folderName;
  const isLoading = hasAppId && resolvedName === undefined;

  const navAdd = useNavigable({
    id: `scan-row-add-${index}`,
    layerId: "scan-modal",
    onPress: onAdd,
  });

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-default-200 bg-default-50/50 px-5 py-4 transition-all hover:bg-default-100/50 dark:bg-default-100/20 dark:hover:bg-default-200/30 shadow-sm ${
        navAdd.isFocused && navAdd.inputMode === "gamepad" ? "border-primary ring-2 ring-primary/50 bg-primary/10" : ""
      }`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Gamepad2 size={20} className="text-primary shrink-0" />
          <p className="truncate text-base font-semibold text-foreground tracking-tight">
            {displayName}
            {isLoading && <Spinner size="sm" className="ml-3 inline-block" color="primary" />}
          </p>
        </div>

        <div className="mt-1 flex items-center gap-1.5 text-default-400">
          <HardDrive size={14} className="shrink-0" />
          <p className="truncate text-xs" title={candidate.path}>
            {candidate.path}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          color="primary"
          variant="flat"
          startContent={<Plus size={16} />}
          onPress={onAdd}
          className={getGamepadFocusClass(navAdd.isFocused, navAdd.inputMode)}
          {...navAdd.navProps}>
          Añadir
        </Button>

        <CandidateMenu onDismiss={onDismiss} />
      </div>
    </div>
  );
}

export function ScanModal({ isOpen, onClose, onSelectCandidate }: ScanModalProps) {
  const {
    data: candidates,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["scan-candidates"],
    queryFn: scanPathCandidates,
    enabled: isOpen,
  });

  const { dismissed, dismiss, clearAll } = useDismissedCandidates();
  const resolvedNames = useResolvedCandidateNames(candidates);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery.trim().toLowerCase(), 300);

  // Candidatos visibles: excluye los descartados persistentemente
  const visibleCandidates = useMemo(() => {
    if (!candidates?.length) return [];
    return candidates.filter((c: PathCandidate) => !dismissed.has(c.path));
  }, [candidates, dismissed]);

  const filteredCandidates = useMemo(() => {
    if (!visibleCandidates.length) return [];
    if (!debouncedSearch) return visibleCandidates;
    return visibleCandidates.filter((c: PathCandidate) => {
      const resolvedName = resolvedNames[c.path];
      const hasAppId = !!c.steamAppId || !!extractAppIdFromFolderName(c.folderName ?? "");
      const displayName = hasAppId && resolvedName ? resolvedName : (c.folderName ?? "");
      const searchIn = [displayName, c.folderName ?? "", c.path, c.basePath ?? ""].join(" ");
      return searchIn.toLowerCase().includes(debouncedSearch);
    });
  }, [visibleCandidates, debouncedSearch, resolvedNames]);

  const dismissedCount = useMemo(
    () => (candidates ?? []).filter((c: PathCandidate) => dismissed.has(c.path)).length,
    [candidates, dismissed]
  );

  const handleAdd = (candidate: PathCandidate) => {
    const resolvedName = resolvedNames[candidate.path];
    const baseName = resolvedName?.trim() || candidate.folderName;
    const gameId = toGameId(baseName);
    const pathsToAdd = candidate.paths?.length ? candidate.paths : [candidate.path];
    onSelectCandidate(pathsToAdd, gameId);
    onClose();
  };

  const navSearch = useNavigable({
    id: "scan-search-input",
    layerId: "scan-modal",
    onPress: () => document.querySelector<HTMLInputElement>('[data-nav-id="scan-search-input"]')?.focus(),
  });

  const navRefetch = useNavigable({
    id: "scan-btn-refetch",
    layerId: "scan-modal",
    onPress: () => refetch(),
  });

  const navClose = useNavigable({
    id: "scan-btn-close",
    layerId: "scan-modal",
    onPress: onClose,
  });

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      size="2xl"
      autoFocus={false}
      scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <FolderOpen size={22} />
          Buscar juegos automáticamente
        </ModalHeader>

        <ModalBody>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div style={{ width: "600px", height: "250px", position: "relative" }}>
                <Suspense>
                  <MagicRings
                    color="#fc42ff"
                    colorTwo="#42fcff"
                    ringCount={6}
                    speed={1.5}
                    attenuation={10}
                    lineThickness={2}
                    baseRadius={0.35}
                    radiusStep={0.1}
                    scaleRate={0.1}
                    opacity={1}
                    blur={0}
                    noiseAmount={0.1}
                    rotation={0}
                    ringGap={1.5}
                    fadeIn={0.7}
                    fadeOut={0.5}
                    followMouse={true}
                    mouseInfluence={0}
                    hoverScale={1}
                    parallax={0}
                    clickBurst={false}
                  />
                </Suspense>
              </div>
              <p className="text-default-500 animate-pulse text-center max-w-md">
                Estamos revisando tu PC para encontrar juegos y sus guardados...
                <br />
                <span className="text-xs text-default-400">
                  Esto puede tardar unos segundos dependiendo de tu sistema
                </span>
              </p>
            </div>
          ) : candidates && candidates.length > 0 ? (
            <>
              {/* Input de Búsqueda Navegable */}
              <div
                className={`rounded-lg transition-all p-1 ${navSearch.isFocused && navSearch.inputMode === "gamepad" ? "ring-2 ring-primary bg-primary/10" : ""}`}
                {...navSearch.navProps}>
                <Input
                  aria-label="Buscar juegos encontrados"
                  classNames={{ inputWrapper: "bg-default-100" }}
                  placeholder="Buscar juego, carpeta o ruta..."
                  startContent={<Search size={18} className="text-default-400" />}
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  onBlur={() => {
                    if (navSearch.inputMode === "mouse") return;
                  }}
                />
              </div>

              {/* Banner de descartados */}
              {dismissedCount > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-default-100 px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2 text-default-500">
                    <EyeOff size={15} className="shrink-0" />
                    <span>
                      {dismissedCount} {dismissedCount === 1 ? "entrada ocultada" : "entradas ocultadas"}
                    </span>
                  </div>
                  <button
                    className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors cursor-pointer"
                    onClick={clearAll}>
                    <Trash2 size={13} />
                    Restaurar todo
                  </button>
                </div>
              )}

              <div
                className="max-h-[60vh] space-y-2 overflow-y-auto pr-2 
                  [&::-webkit-scrollbar]:w-1.5
                  [&::-webkit-scrollbar-track]:bg-transparent
                  [&::-webkit-scrollbar-thumb]:bg-default-300
                  [&::-webkit-scrollbar-thumb]:rounded-full
                  hover:[&::-webkit-scrollbar-thumb]:bg-default-400">
                {filteredCandidates.length > 0 ? (
                  filteredCandidates.map((c: PathCandidate, idx: number) => (
                    <CandidateRow
                      key={c.path}
                      candidate={c}
                      resolvedName={resolvedNames[c.path]}
                      onAdd={() => handleAdd(c)}
                      onDismiss={() => dismiss(c.path)}
                      index={idx}
                    />
                  ))
                ) : debouncedSearch ? (
                  <p className="py-6 text-center text-sm text-default-500">
                    No hay coincidencias para &quot;{searchQuery}&quot;
                  </p>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <EyeOff size={36} className="text-default-300" />
                    <p className="text-default-500 text-sm">Todas las entradas encontradas han sido ocultadas.</p>
                    {dismissedCount > 0 && (
                      <button
                        className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                        onClick={clearAll}>
                        Restaurar entradas ocultadas
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <FolderOpen size={48} className="text-default-400" />
              <p className="text-default-500">No se encontraron carpetas candidatas.</p>
              <p className="text-sm text-default-400">Puedes añadir un juego manualmente con su ruta.</p>
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <Button
            variant="flat"
            onPress={() => refetch()}
            isDisabled={isLoading}
            className={getGamepadFocusClass(navRefetch.isFocused, navRefetch.inputMode)}
            {...navRefetch.navProps}>
            Volver a analizar
          </Button>

          <Button
            variant="flat"
            onPress={onClose}
            className={getGamepadFocusClass(navClose.isFocused, navClose.inputMode)}
            {...navClose.navProps}>
            Cerrar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
