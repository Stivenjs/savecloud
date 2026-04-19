const PENDING_FRIEND_PROFILE_KEY = "friendsPagePendingProfileUserId";
const OPEN_FRIEND_PROFILE_EVENT = "savecloud:open-friend-profile";

type OpenFriendProfileDetail = {
  userId: string;
};

export function requestOpenFriendProfile(userId: string) {
  const normalized = userId.trim();
  if (!normalized) return;

  try {
    sessionStorage.setItem(PENDING_FRIEND_PROFILE_KEY, normalized);
  } catch {}

  window.dispatchEvent(
    new CustomEvent<OpenFriendProfileDetail>(OPEN_FRIEND_PROFILE_EVENT, { detail: { userId: normalized } })
  );
}

export function consumePendingFriendProfileUserId(): string | null {
  try {
    const value = sessionStorage.getItem(PENDING_FRIEND_PROFILE_KEY)?.trim();
    if (!value) return null;
    sessionStorage.removeItem(PENDING_FRIEND_PROFILE_KEY);
    return value;
  } catch {
    return null;
  }
}

export function onRequestOpenFriendProfile(handler: (userId: string) => void) {
  const listener = (event: Event) => {
    const custom = event as CustomEvent<OpenFriendProfileDetail>;
    const id = custom.detail?.userId?.trim();
    if (!id) return;
    handler(id);
  };

  window.addEventListener(OPEN_FRIEND_PROFILE_EVENT, listener as EventListener);
  return () => {
    window.removeEventListener(OPEN_FRIEND_PROFILE_EVENT, listener as EventListener);
  };
}
