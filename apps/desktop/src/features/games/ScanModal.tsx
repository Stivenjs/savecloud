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
          <MoreVertical size={15} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="min-w-47.5 border border-default-200/80 p-1 shadow-sm">
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-default-100"
          onClick={() => {
            onDismiss();
            setOpen(false);
          }}>
          <EyeOff size={14} className="shrink-0 text-default-400" />
          <div>
            <p className="font-medium leading-tight text-foreground">No es un juego</p>
            <p className="mt-0.5 text-[11px] leading-tight text-default-400">No volver a mostrar esto</p>
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
    <li
      className={`flex flex-col gap-3 rounded-lg border border-default-200/70 px-4 py-3 transition-colors hover:border-default-300 hover:bg-default-50 outline-none focus-within:ring-0 focus-within:border-default-200/70 sm:flex-row sm:items-center sm:justify-between ${
        navAdd.isFocused && navAdd.inputMode === "gamepad" ? "border-primary/40 bg-primary/5" : ""
      }`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Gamepad2 size={15} className="shrink-0 text-primary" />
          <p className="truncate text-sm font-medium text-foreground">
            {displayName}
            {isLoading && <Spinner size="sm" className="ml-2 inline-block" color="default" />}
          </p>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <HardDrive size={12} className="shrink-0 text-default-400" />
          <p className="truncate text-[11px] text-default-400" title={candidate.path}>
            {candidate.path}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          color="primary"
          variant="flat"
          startContent={<Plus size={14} />}
          onPress={onAdd}
          className={getGamepadFocusClass(navAdd.isFocused, navAdd.inputMode)}
          {...navAdd.navProps}>
          Añadir
        </Button>
        <CandidateMenu onDismiss={onDismiss} />
      </div>
    </li>
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

  const navRefetch = useNavigable({ id: "scan-btn-refetch", layerId: "scan-modal", onPress: () => refetch() });
  const navClose = useNavigable({ id: "scan-btn-close", layerId: "scan-modal", onPress: onClose });

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      size="2xl"
      autoFocus={false}
      scrollBehavior="inside"
      classNames={{
        header: "border-b border-default-200/80 pb-3",
        footer: "border-t border-default-200/80 pt-3",
        body: "py-3",
        closeButton: "hidden",
      }}>
      <ModalContent>
        <ModalHeader className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FolderOpen size={15} className="text-secondary" />
            Buscar juegos automáticamente
          </div>
          <Button isIconOnly size="sm" variant="light" className="size-7 min-w-0 text-default-400" onPress={onClose}>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="12" height="12">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </Button>
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
              <p className="max-w-md animate-pulse text-center text-sm text-default-500">
                Revisando tu PC para encontrar juegos y sus guardados...
                <br />
                <span className="text-xs text-default-400">
                  Esto puede tardar unos segundos dependiendo de tu sistema
                </span>
              </p>
            </div>
          ) : candidates && candidates.length > 0 ? (
            <div className="flex flex-col gap-3">
              {/* Buscador */}
              <div
                className={`rounded-lg transition-all ${navSearch.isFocused && navSearch.inputMode === "gamepad" ? "ring-2 ring-primary/30" : ""}`}
                {...navSearch.navProps}>
                <Input
                  aria-label="Buscar juegos encontrados"
                  placeholder="Buscar juego, carpeta o ruta..."
                  size="sm"
                  radius="lg"
                  startContent={<Search size={13} className="text-default-400" />}
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  classNames={{
                    inputWrapper:
                      "bg-default-100/60 border border-default-200/80 shadow-none data-[hover=true]:border-default-300 data-[focus-within=true]:!border-default-300 data-[focus=true]:!border-default-300",
                  }}
                />
              </div>

              {/* Banner descartados */}
              {dismissedCount > 0 && (
                <div className="flex items-center justify-between rounded-lg border border-default-200/70 bg-default-50 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 text-default-500">
                    <EyeOff size={13} className="shrink-0" />
                    <span>
                      {dismissedCount} {dismissedCount === 1 ? "entrada ocultada" : "entradas ocultadas"}
                    </span>
                  </div>
                  <button
                    className="flex items-center gap-1 font-medium text-primary transition-colors hover:text-primary/70"
                    onClick={clearAll}>
                    <Trash2 size={12} />
                    Restaurar todo
                  </button>
                </div>
              )}

              {/* Lista */}
              <ul className="flex flex-col gap-2 overflow-y-auto pr-0.5 max-h-[55vh] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-default-300 hover:[&::-webkit-scrollbar-thumb]:bg-default-400">
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
                  <li className="py-8 text-center text-sm text-default-400">
                    No hay coincidencias para &quot;{searchQuery}&quot;
                  </li>
                ) : (
                  <li className="flex flex-col items-center gap-3 py-10 text-center">
                    <EyeOff size={28} className="text-default-300" />
                    <p className="text-sm text-default-400">Todas las entradas encontradas han sido ocultadas.</p>
                    {dismissedCount > 0 && (
                      <button
                        className="text-xs font-medium text-primary transition-colors hover:text-primary/70"
                        onClick={clearAll}>
                        Restaurar entradas ocultadas
                      </button>
                    )}
                  </li>
                )}
              </ul>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <FolderOpen size={36} className="text-default-300" />
              <p className="text-sm text-default-500">No se encontraron carpetas candidatas.</p>
              <p className="text-xs text-default-400">Puedes añadir un juego manualmente con su ruta.</p>
            </div>
          )}
        </ModalBody>

        <ModalFooter className="flex items-center justify-between">
          <span className="text-xs text-default-400">
            {!isLoading && candidates
              ? `${visibleCandidates.length} encontrado${visibleCandidates.length !== 1 ? "s" : ""}`
              : ""}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="flat"
              onPress={() => refetch()}
              isDisabled={isLoading}
              className={getGamepadFocusClass(navRefetch.isFocused, navRefetch.inputMode)}
              {...navRefetch.navProps}>
              Volver a analizar
            </Button>
            <Button
              size="sm"
              variant="flat"
              onPress={onClose}
              className={getGamepadFocusClass(navClose.isFocused, navClose.inputMode)}
              {...navClose.navProps}>
              Cerrar
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
