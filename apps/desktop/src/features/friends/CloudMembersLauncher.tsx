import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@heroui/react";
import { Users } from "lucide-react";
import { CloudMembersModal } from "@features/friends/CloudMembersModal";
import { useCloudMembersActions } from "@hooks/useCloudMembersActions";
import { requestOpenFriendProfile } from "@features/friends/friendProfileNavigation";
import { openOrFocusFriendsWindow } from "@/windows/friendsWindow";

export function CloudMembersLauncher() {
  const navigate = useNavigate();
  const [open, setIsOpen] = useState(false);
  const modalRef = useRef<HTMLElement>(null as unknown as HTMLElement);

  const { handleRemoveMember, handleLeaveMembership } = useCloudMembersActions();

  const handleViewProfileWithNavigation = (userId: string) => {
    requestOpenFriendProfile(userId);
    setIsOpen(false);
    navigate("/friends");
  };

  const handleDetachToWindow = async () => {
    setIsOpen(false);
    await openOrFocusFriendsWindow();
  };

  return (
    <>
      <Button
        isIconOnly
        variant="light"
        radius="full"
        color="default"
        size="sm"
        className="h-9 w-9 min-w-0 text-foreground hover:bg-default-100/50"
        aria-label="Abrir miembros cloud"
        onPress={() => setIsOpen(true)}>
        <Users size={18} />
      </Button>

      <CloudMembersModal
        isOpen={open}
        onClose={() => setIsOpen(false)}
        onViewProfile={handleViewProfileWithNavigation}
        onRemoveMember={handleRemoveMember}
        onLeaveMembership={handleLeaveMembership}
        modalRef={modalRef}
        onDetachToWindow={() => {
          void handleDetachToWindow();
        }}
      />
    </>
  );
}
