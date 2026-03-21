import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Spinner } from "@heroui/react";
import { FolderOpen, Plus, Search } from "lucide-react";
import { scanPathCandidates } from "@services/tauri";
import type { PathCandidate } from "@services/tauri";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { useResolvedCandidateNames } from "@hooks/useResolvedCandidateNames";
import { extractAppIdFromFolderName, toGameId } from "@utils/gameImage";
import MagicRings from "@components/external/MagicRings";
import { useNavigable } from "@features/input/useNavigable";
import { getGamepadFocusClass } from "@features/input/styles";

interface ScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCandidate: (paths: string[], suggestedId: string) => void;
}

function CandidateRow({
  candidate,
  resolvedName,
  onAdd,
  index,
}: {
  candidate: PathCandidate;
  resolvedName: string | null | undefined;
  onAdd: () => void;
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
      className={`flex items-center justify-between gap-4 rounded-lg border border-default-200 bg-default-50/50 px-4 py-3 dark:bg-default-100/20 transition-all ${
        navAdd.isFocused && navAdd.inputMode === "gamepad" ? "border-primary bg-primary/10" : ""
      }`}>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">
          {displayName}
          {isLoading && <Spinner size="sm" className="ml-2 inline-block" color="primary" />}
        </p>
        <p className="truncate text-sm text-default-500" title={candidate.path}>
          {candidate.path}
        </p>
        <p className="text-xs text-default-400">{candidate.basePath}</p>
      </div>

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

  const resolvedNames = useResolvedCandidateNames(candidates);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery.trim().toLowerCase(), 300);

  const filteredCandidates = useMemo(() => {
    if (!candidates?.length) return [];
    if (!debouncedSearch) return candidates;
    return candidates.filter((c) => {
      const resolvedName = resolvedNames[c.path];
      const hasAppId = !!c.steamAppId || !!extractAppIdFromFolderName(c.folderName ?? "");
      const displayName = hasAppId && resolvedName ? resolvedName : (c.folderName ?? "");
      const searchIn = [displayName, c.folderName ?? "", c.path, c.basePath ?? ""].join(" ");
      return searchIn.toLowerCase().includes(debouncedSearch);
    });
  }, [candidates, debouncedSearch, resolvedNames]);

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
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} size="2xl" autoFocus={false}>
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <FolderOpen size={22} />
          Analizar rutas
        </ModalHeader>

        <ModalBody>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div style={{ width: "600px", height: "250px", position: "relative" }}>
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
              </div>
              <p className="text-default-500 animate-pulse">Buscando carpetas de guardados en el sistema...</p>
            </div>
          ) : candidates && candidates.length > 0 ? (
            <>
              {/* Input de Búsqueda Navegable */}
              <div
                className={`rounded-lg transition-all p-1 ${navSearch.isFocused && navSearch.inputMode === "gamepad" ? "ring-2 ring-primary bg-primary/10" : ""}`}
                {...navSearch.navProps}>
                <Input
                  aria-label="Buscar en los resultados"
                  classNames={{ inputWrapper: "bg-default-100" }}
                  placeholder="Buscar en los resultados..."
                  startContent={<Search size={18} className="text-default-400" />}
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  onBlur={() => {
                    if (navSearch.inputMode === "mouse") return;
                  }}
                />
              </div>

              <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-2">
                {filteredCandidates.length > 0 ? (
                  filteredCandidates.map((c, idx) => (
                    <CandidateRow
                      key={c.path}
                      candidate={c}
                      resolvedName={resolvedNames[c.path]}
                      onAdd={() => handleAdd(c)}
                      index={idx}
                    />
                  ))
                ) : (
                  <p className="py-6 text-center text-sm text-default-500">
                    No hay coincidencias para &quot;{searchQuery}&quot;
                  </p>
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
