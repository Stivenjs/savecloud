import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal, ModalBody, ModalContent, ModalHeader, Spinner, useDraggable } from "@heroui/react";
import { motion } from "framer-motion";
import { UserRound } from "lucide-react";
import { listCloudMemberships, listCloudPresence } from "@services/tauri/invites.service";
import { CloudMembersHeader } from "@features/friends/CloudMembersHeader";
import { CloudMembersSection } from "@features/friends/CloudMembersSection";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { useCloudPresenceRealtimeInvalidation } from "@hooks/useCloudPresenceRealtimeInvalidation";
import { useDebouncedValue } from "@hooks/useDebouncedValue";

interface CloudMembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  onRemoveMember?: (userId: string) => Promise<void>;
  onLeaveMembership?: (hostId: string) => Promise<void>;
  modalRef: React.RefObject<HTMLElement>;
}

export function CloudMembersModal({
  isOpen,
  onClose,
  onViewProfile,
  onRemoveMember,
  onLeaveMembership,
  modalRef,
}: CloudMembersModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);

  const { moveProps } = useDraggable({
    targetRef: modalRef,
    canOverflow: false,
    isDisabled: !isOpen,
  });

  useCloudPresenceRealtimeInvalidation(isOpen);

  useRegisterGlobalBack(() => {
    if (!isOpen) return false;
    onClose();
    return true;
  });

  const {
    data: memberships,
    isLoading: membershipsLoading,
    isError: membershipsError,
    refetch: refetchMemberships,
  } = useQuery({
    queryKey: ["cloud-memberships"],
    queryFn: listCloudMemberships,
    refetchInterval: isOpen ? 30_000 : false,
    enabled: isOpen,
  });

  const {
    data: cloudPresence = [],
    isLoading: cloudPresenceLoading,
    refetch: refetchPresence,
  } = useQuery({
    queryKey: ["cloud-presence"],
    queryFn: listCloudPresence,
    refetchInterval: isOpen ? 30_000 : false,
    enabled: isOpen,
  });

  const presenceByUser = useMemo(() => new Map(cloudPresence.map((item) => [item.userId, item])), [cloudPresence]);

  const hostMemberships = memberships?.hostMemberships ?? [];
  const memberMemberships = memberships?.memberMemberships ?? [];
  const hasAnyMembers = hostMemberships.length > 0 || memberMemberships.length > 0;

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetchMemberships(), refetchPresence()]);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchMemberships, refetchPresence]);

  const handleViewProfile = useCallback(
    (userId: string) => {
      onViewProfile(userId);
      onClose();
    },
    [onViewProfile, onClose]
  );

  const handleRemoveMember = useCallback(
    async (userId: string) => {
      if (!onRemoveMember) return;
      setIsActionLoading(userId);
      try {
        await onRemoveMember(userId);
      } finally {
        setIsActionLoading(null);
      }
    },
    [onRemoveMember]
  );

  const handleLeaveMembership = useCallback(
    async (hostId: string) => {
      if (!onLeaveMembership) return;
      setIsActionLoading(hostId);
      try {
        await onLeaveMembership(hostId);
      } finally {
        setIsActionLoading(null);
      }
    },
    [onLeaveMembership]
  );

  return (
    <Modal
      ref={modalRef}
      isOpen={isOpen}
      onOpenChange={(isOpenChange) => {
        if (isOpenChange) return;
        onClose();
      }}
      isDismissable={false}
      isKeyboardDismissDisabled
      hideCloseButton
      backdrop="transparent"
      placement="center"
      classNames={{
        wrapper: "z-[9999]",
        base: "flex h-[min(82dvh,760px)] w-[min(86vw,340px)] flex-col overflow-hidden rounded-[18px] border border-default-200/80 bg-background/65 shadow-2xl backdrop-blur-md",
      }}>
      <ModalContent>
        {() => (
          <motion.div layout className="flex h-full flex-col">
            <motion.div layout className="w-full">
              <ModalHeader {...moveProps} className="w-full p-0">
                <CloudMembersHeader
                  isRefreshing={isRefreshing}
                  onRefresh={handleRefresh}
                  onClose={onClose}
                  searchValue={searchQuery}
                  onSearchChange={setSearchQuery}
                  moveProps={moveProps}
                />
              </ModalHeader>
            </motion.div>

            <motion.div layout className="min-h-0 flex-1">
              <ModalBody className="h-full overflow-y-auto px-2.5 py-2.5">
                {/* Estado: Cargando */}
                {membershipsLoading ? (
                  <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-default-500">
                    <Spinner size="md" color="primary" />
                    <p className="text-sm">Cargando miembros...</p>
                  </div>
                ) : null}

                {/* Estado: Error */}
                {!membershipsLoading && membershipsError ? (
                  <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    No se pudieron cargar los miembros.
                  </div>
                ) : null}

                {/* Estado: Vacío */}
                {!membershipsLoading && !membershipsError && !hasAnyMembers ? (
                  <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-default-200/80 bg-background/45 px-4 py-6 text-center">
                    <UserRound className="h-5 w-5 text-default-400" />
                    <p className="text-sm text-default-500">No hay miembros cloud para mostrar.</p>
                  </div>
                ) : null}

                {/* Estado: Con datos */}
                {!membershipsLoading && !membershipsError && hasAnyMembers ? (
                  <div className="space-y-3">
                    <CloudMembersSection
                      title="En tu nube"
                      memberships={hostMemberships}
                      presenceMap={presenceByUser}
                      isHost={true}
                      loadingPresence={cloudPresenceLoading}
                      isActionLoading={isActionLoading}
                      onViewProfile={handleViewProfile}
                      onRemoveMember={onRemoveMember ? handleRemoveMember : undefined}
                      searchQuery={debouncedSearchQuery}
                    />

                    <CloudMembersSection
                      title="Miembro de"
                      memberships={memberMemberships}
                      presenceMap={presenceByUser}
                      isHost={false}
                      loadingPresence={cloudPresenceLoading}
                      isActionLoading={isActionLoading}
                      onViewProfile={handleViewProfile}
                      onLeaveMembership={onLeaveMembership ? handleLeaveMembership : undefined}
                      searchQuery={debouncedSearchQuery}
                    />
                  </div>
                ) : null}
              </ModalBody>
            </motion.div>
          </motion.div>
        )}
      </ModalContent>
    </Modal>
  );
}
