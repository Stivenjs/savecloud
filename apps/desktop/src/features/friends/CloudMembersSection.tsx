import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CloudMembership, CloudPresenceItem } from "@services/tauri/invites.service";
import { CloudMemberRow } from "@features/friends/CloudMemberRow";

interface CloudMembersSectionProps {
  title: string;
  memberships: CloudMembership[];
  presenceMap: Map<string, CloudPresenceItem>;
  isHost: boolean;
  loadingPresence: boolean;
  isActionLoading?: string | null;
  onViewProfile: (userId: string) => void;
  onRequestRemoveMember?: (userId: string) => void;
  onRequestLeaveMembership?: (hostId: string) => void;
  onRemoveMember?: (userId: string) => Promise<void>;
  onLeaveMembership?: (hostId: string) => Promise<void>;
  searchQuery?: string;
}

export function CloudMembersSection({
  title,
  memberships,
  presenceMap,
  isHost,
  loadingPresence,
  isActionLoading = null,
  onViewProfile,
  onRequestRemoveMember,
  onRequestLeaveMembership,
  onRemoveMember,
  onLeaveMembership,
  searchQuery = "",
}: CloudMembersSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Filtrar miembros según búsqueda
  const filteredMemberships = memberships.filter((m) => {
    const userId = isHost ? m.memberUserId : m.hostUserId;
    return userId.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const hasMembers = memberships.length > 0;

  return (
    <div className="space-y-2">
      {/* Header de sección colapsable */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-default-100/50 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-default-500">{title}</span>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-default-200/50 text-[10px] font-medium text-default-600">
            {memberships.length}
          </span>
        </div>
        <ChevronDown className={`h-4 w-4 text-default-400 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
      </button>

      {/* Contenido colapsable */}
      {isExpanded && (
        <div className="space-y-2 pl-1">
          {hasMembers ? (
            <>
              {filteredMemberships.length > 0 ? (
                filteredMemberships.map((membership) => {
                  const userId = isHost ? membership.memberUserId : membership.hostUserId;
                  const presence = presenceMap.get(userId);

                  return (
                    <CloudMemberRow
                      key={`${membership.hostUserId}-${membership.memberUserId}`}
                      membership={membership}
                      isHost={isHost}
                      userId={userId}
                      status={presence?.status}
                      gameName={presence?.gameName}
                      loadingPresence={loadingPresence}
                      isActionLoading={isActionLoading === userId}
                      onViewProfile={onViewProfile}
                      onRequestRemoveMember={onRequestRemoveMember}
                      onRequestLeaveMembership={onRequestLeaveMembership}
                      onRemoveMember={onRemoveMember}
                      onLeaveMembership={onLeaveMembership}
                    />
                  );
                })
              ) : (
                <p className="rounded-lg border border-default-200/50 bg-default-50/50 px-2.5 py-2 text-xs text-default-500">
                  No se encontraron miembros.
                </p>
              )}
            </>
          ) : (
            <p className="rounded-lg border border-default-200/50 bg-default-50/50 px-2.5 py-2 text-xs text-default-500">
              {isHost ? "No tienes miembros activos." : "No perteneces a otras nubes."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
