import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCloudMembersActions } from "@hooks/useCloudMembersActions";
import { TitleBar } from "@components/layout/TitleBar";
import { CloudMembersPanel } from "@features/friends/CloudMembersPanel";
import { focusMainWindow } from "@/windows/mainWindow";
import { requestOpenFriendProfile } from "@features/friends/friendProfileNavigation";

export function FriendsWindowPage() {
  const { handleRemoveMember, handleLeaveMembership } = useCloudMembersActions();

  const handleHideWindow = () => {
    void getCurrentWindow().hide();
  };

  const handleViewProfile = async (userId: string) => {
    requestOpenFriendProfile(userId);
    await emit("open-friends-page");
    await focusMainWindow();
    await getCurrentWindow().hide();
  };

  return (
    <div className="min-h-screen bg-background">
      <TitleBar />
      <div className="h-screen overflow-hidden px-2 pb-2 pt-12">
        <CloudMembersPanel
          isOpen
          onClose={handleHideWindow}
          onViewProfile={(userId) => {
            void handleViewProfile(userId);
          }}
          onRemoveMember={handleRemoveMember}
          onLeaveMembership={handleLeaveMembership}
          draggable={false}
          showCloseButton={false}
        />
      </div>
    </div>
  );
}
