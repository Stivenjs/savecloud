import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@heroui/react";
import { Users } from "lucide-react";
import { CloudMembersModal } from "@features/friends/CloudMembersModal";
import { useCloudMembersActions } from "@hooks/useCloudMembersActions";
import { requestOpenFriendProfile } from "@features/friends/friendProfileNavigation";

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

  return (
    <>
      <Button
        isIconOnly
        variant="light"
        radius="md"
        color="default"
        size="lg"
        className="text-foreground"
        aria-label="Abrir miembros cloud"
        onPress={() => setIsOpen(true)}>
        <Users size={20} />
      </Button>

      <CloudMembersModal
        isOpen={open}
        onClose={() => setIsOpen(false)}
        onViewProfile={handleViewProfileWithNavigation}
        onRemoveMember={handleRemoveMember}
        onLeaveMembership={handleLeaveMembership}
        modalRef={modalRef}
      />
    </>
  );
}
