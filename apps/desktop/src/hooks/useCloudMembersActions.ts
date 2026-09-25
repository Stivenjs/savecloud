import { useCallback } from "react";
import { useFriendsPage } from "@hooks/useFriendsPage";

export function useCloudMembersActions() {
  const { handleRemoveMember, handleLeaveMembership, loadFriendProfileById } = useFriendsPage();

  const handleViewProfile = useCallback(
    async (userId: string) => {
      try {
        await loadFriendProfileById(userId);
      } catch (error) {
        console.error("Error loading friend profile:", error);
      }
    },
    [loadFriendProfileById]
  );

  const handleRemove = useCallback(
    async (userId: string) => {
      try {
        await handleRemoveMember(userId);
      } catch (error) {
        console.error("Error removing member:", error);
        throw error;
      }
    },
    [handleRemoveMember]
  );

  const handleLeave = useCallback(
    async (hostId: string) => {
      try {
        await handleLeaveMembership(hostId);
      } catch (error) {
        console.error("Error leaving membership:", error);
        throw error;
      }
    },
    [handleLeaveMembership]
  );

  return {
    handleViewProfile,
    handleRemoveMember: handleRemove,
    handleLeaveMembership: handleLeave,
  };
}
