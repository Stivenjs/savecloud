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

  try {
    localStorage.setItem(PENDING_FRIEND_PROFILE_KEY, normalized);
  } catch {}

  window.dispatchEvent(
    new CustomEvent<OpenFriendProfileDetail>(OPEN_FRIEND_PROFILE_EVENT, { detail: { userId: normalized } })
  );
}

export function consumePendingFriendProfileUserId(): string | null {
  const readStorage = (storage: Storage) => {
    const value = storage.getItem(PENDING_FRIEND_PROFILE_KEY)?.trim();
    if (!value) return null;
    storage.removeItem(PENDING_FRIEND_PROFILE_KEY);
    return value;
  };

  try {
    const fromSession = readStorage(sessionStorage);
    if (fromSession) return fromSession;
  } catch {}

  try {
    return readStorage(localStorage);
  } catch {
    return null;
  }
}

export function onRequestOpenFriendProfile(handler: (userId: string) => void) {
  const handleCustomEvent = (event: Event) => {
    const custom = event as CustomEvent<OpenFriendProfileDetail>;
    const id = custom.detail?.userId?.trim();
    if (!id) return;
    handler(id);
  };

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== PENDING_FRIEND_PROFILE_KEY) return;
    const id = event.newValue?.trim();
    if (!id) return;
    try {
      localStorage.removeItem(PENDING_FRIEND_PROFILE_KEY);
    } catch {}
    handler(id);
  };

  window.addEventListener(OPEN_FRIEND_PROFILE_EVENT, handleCustomEvent as EventListener);
  window.addEventListener("storage", handleStorageEvent);
  return () => {
    window.removeEventListener(OPEN_FRIEND_PROFILE_EVENT, handleCustomEvent as EventListener);
    window.removeEventListener("storage", handleStorageEvent);
  };
}
