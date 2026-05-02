import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCloudMembersActions } from "@hooks/useCloudMembersActions";
import { TitleBar } from "@components/layout/TitleBar";
import { CloudMembersPanel } from "@features/friends/CloudMembersPanel";
import { focusMainWindow } from "@features/friends/friendsWindow";
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
      <div className="h-screen px-2 pb-2 pt-12">
        <div className="h-full overflow-hidden rounded-[18px] border border-default-200/80 bg-background/65 shadow-2xl backdrop-blur-md">
          <CloudMembersPanel
            isOpen
            onClose={handleHideWindow}
            onViewProfile={(userId) => {
              void handleViewProfile(userId);
            }}
            onRemoveMember={handleRemoveMember}
            onLeaveMembership={handleLeaveMembership}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
