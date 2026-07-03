import { useMemo, useState } from "react";
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from "@heroui/react";
import { Eye, LogOut, Trash2, MoreVertical } from "lucide-react";
import type { CloudMembership } from "@services/tauri/invites.service";
import { useTranslation } from "react-i18next";

interface CloudMemberActionsProps {
  userId: string;
  membership: CloudMembership;
  isHost: boolean;
  isLoading: boolean;
  onViewProfile: (userId: string) => void;
  onRequestRemoveMember?: (userId: string) => void;
  onRequestLeaveMembership?: (hostId: string) => void;
  onRemoveMember?: (userId: string) => Promise<void>;
  onLeaveMembership?: (hostId: string) => Promise<void>;
}

export function CloudMemberActions({
  userId,
  membership,
  isHost,
  isLoading,
  onViewProfile,
  onRequestRemoveMember,
  onRequestLeaveMembership,
  onRemoveMember,
  onLeaveMembership,
}: CloudMemberActionsProps) {
  const { t } = useTranslation();
  const [isActionLoading, setIsActionLoading] = useState(false);

  const actions = useMemo(() => {
    const items: Array<{ key: string; label: string; icon: React.ReactNode; color?: string; action: () => void }> = [
      {
        key: "view",
        label: t("friends.cloudMembers.viewProfile"),
        icon: <Eye className="h-4 w-4" />,
        action: () => onViewProfile(userId),
      },
    ];

    if (isHost && onRemoveMember) {
      items.push({
        key: "remove",
        label: t("friends.cloudMembers.removeMember"),
        icon: <Trash2 className="h-4 w-4" />,
        color: "danger",
        action: () => {
          if (onRequestRemoveMember) {
            onRequestRemoveMember(userId);
            return;
          }

          void (async () => {
            setIsActionLoading(true);
            try {
              await onRemoveMember(userId);
            } finally {
              setIsActionLoading(false);
            }
          })();
        },
      });
    } else if (!isHost && onLeaveMembership && userId === membership.hostUserId) {
      items.push({
        key: "leave",
        label: t("friends.cloudMembers.leaveMembership"),
        icon: <LogOut className="h-4 w-4" />,
        color: "warning",
        action: () => {
          if (onRequestLeaveMembership) {
            onRequestLeaveMembership(membership.hostUserId);
            return;
          }

          void (async () => {
            setIsActionLoading(true);
            try {
              await onLeaveMembership(membership.hostUserId);
            } finally {
              setIsActionLoading(false);
            }
          })();
        },
      });
    }

    return items;
  }, [
    isHost,
    userId,
    onViewProfile,
    onRequestRemoveMember,
    onRequestLeaveMembership,
    onRemoveMember,
    onLeaveMembership,
    membership.hostUserId,
    t,
  ]);

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
      <DropdownMenu
        onPointerDownCapture={(event) => event.stopPropagation()}
        aria-label={t("friends.cloudMembers.actionsAria")}>
        {actions.map((action) => (
          <DropdownItem key={action.key} color={action.color as any} startContent={action.icon} onPress={action.action}>
            {action.label}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
