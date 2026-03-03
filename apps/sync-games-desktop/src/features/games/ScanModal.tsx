import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
} from "@heroui/react";
import { FolderOpen, Plus } from "lucide-react";
import { scanPathCandidates } from "@services/tauri";
import type { PathCandidate } from "@services/tauri";
import { useResolvedCandidateNames } from "@hooks/useResolvedCandidateNames";
import { extractAppIdFromFolderName, toGameId } from "@utils/gameImage";

interface ScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCandidate: (path: string, suggestedId: string) => void;
}

function CandidateRow({
  candidate,
  resolvedName,
  onAdd,
}: {
  candidate: PathCandidate;
  resolvedName: string | null | undefined;
  onAdd: () => void;
}) {
  const hasAppId = !!extractAppIdFromFolderName(candidate.folderName ?? "");
  const displayName =
    hasAppId && resolvedName ? resolvedName : candidate.folderName;
  const isLoading = hasAppId && resolvedName === undefined;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-default-200 bg-default-50/50 px-4 py-3 dark:bg-default-100/20">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">
          {displayName}
          {isLoading && (
            <Spinner size="sm" className="ml-2 inline-block" color="primary" />
          )}
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
        onPress={() => onAdd()}
      >
        Añadir
      </Button>
    </div>
  );
}

export function ScanModal({
  isOpen,
  onClose,
  onSelectCandidate,
}: ScanModalProps) {
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

  const handleAdd = (candidate: PathCandidate) => {
    const resolvedName = resolvedNames[candidate.path];
    const baseName = resolvedName?.trim() || candidate.folderName;
    onSelectCandidate(candidate.path, toGameId(baseName));
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      size="2xl"
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <FolderOpen size={22} />
          Analizar rutas
        </ModalHeader>
        <ModalBody>
          {isLoading ? (
            <div className="flex flex-col items-center gap-4 py-12">
              <Spinner size="lg" color="primary" />
              <p className="text-default-500">
                Buscando carpetas de guardados en el sistema...
              </p>
            </div>
          ) : candidates && candidates.length > 0 ? (
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-2">
              {candidates.map((c) => (
                <CandidateRow
                  key={c.path}
                  candidate={c}
                  resolvedName={resolvedNames[c.path]}
                  onAdd={() => handleAdd(c)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <FolderOpen size={48} className="text-default-400" />
              <p className="text-default-500">
                No se encontraron carpetas candidatas.
              </p>
              <p className="text-sm text-default-400">
                Puedes añadir un juego manualmente con su ruta.
              </p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="flat"
            onPress={() => refetch()}
            isDisabled={isLoading}
          >
            Volver a analizar
          </Button>
          <Button variant="flat" onPress={onClose}>
            Cerrar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
