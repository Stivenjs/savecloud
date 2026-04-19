import { useMemo, useState } from "react";
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from "@heroui/react";
import { Eye, LogOut, Trash2, MoreVertical } from "lucide-react";
import type { CloudMembership } from "@services/tauri/invites.service";

interface CloudMemberActionsProps {
  membership: CloudMembership;
  isHost: boolean;
  isLoading: boolean;
  onViewProfile: (userId: string) => void;
  onRemoveMember?: (userId: string) => Promise<void>;
  onLeaveMembership?: (hostId: string) => Promise<void>;
}

export function CloudMemberActions({
  membership,
  isHost,
  isLoading,
  onViewProfile,
  onRemoveMember,
  onLeaveMembership,
}: CloudMemberActionsProps) {
  const [isActionLoading, setIsActionLoading] = useState(false);
  const userId = isHost ? membership.memberUserId : membership.hostUserId;

  const actions = useMemo(() => {
    const items: Array<{ key: string; label: string; icon: React.ReactNode; color?: string; action: () => void }> = [
      {
        key: "view",
        label: "Ver perfil",
        icon: <Eye className="h-4 w-4" />,
        action: () => onViewProfile(userId),
      },
    ];

    if (isHost && onRemoveMember) {
      items.push({
        key: "remove",
        label: "Remover miembro",
        icon: <Trash2 className="h-4 w-4" />,
        color: "danger",
        action: async () => {
          setIsActionLoading(true);
          try {
            await onRemoveMember(userId);
          } finally {
            setIsActionLoading(false);
          }
        },
      });
    } else if (!isHost && onLeaveMembership) {
      items.push({
        key: "leave",
        label: "Dejar membresía",
        icon: <LogOut className="h-4 w-4" />,
        color: "warning",
        action: async () => {
          setIsActionLoading(true);
          try {
            await onLeaveMembership(membership.hostUserId);
          } finally {
            setIsActionLoading(false);
          }
        },
      });
    }

    return items;
  }, [isHost, userId, onViewProfile, onRemoveMember, onLeaveMembership, membership.hostUserId]);

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button
          isIconOnly
          size="sm"
          variant="light"
          isLoading={isActionLoading}
          isDisabled={isLoading || isActionLoading}
          onPointerDownCapture={(event) => event.stopPropagation()}>
          {!isActionLoading && <MoreVertical className="h-4 w-4" />}
        </Button>
      </DropdownTrigger>
      <DropdownMenu onPointerDownCapture={(event) => event.stopPropagation()} aria-label="Acciones de miembro">
        {actions.map((action) => (
          <DropdownItem key={action.key} color={action.color as any} startContent={action.icon} onPress={action.action}>
            {action.label}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
