import { Avatar } from "@heroui/react";
import { ProfileAvatarVisual } from "@features/profile/ProfileAvatarVisual";
import { resolveProfileAsset } from "@utils/profileMedia";

interface ProfileAvatarProps {
  rawAvatar: string | null | undefined;
  userId: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function ProfileAvatar({ rawAvatar, userId, size = "md", className = "" }: ProfileAvatarProps) {
  const isNiceAvatar = !!(
    rawAvatar &&
    (rawAvatar.startsWith("nice-avatar://") || rawAvatar.startsWith("data:image/svg+xml"))
  );

  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-12 w-12",
  };

  if (isNiceAvatar) {
    return (
      <div
        className={`${sizeClasses[size]} rounded-full overflow-hidden shrink-0 border border-default-200 bg-default-100 flex items-center justify-center ${className}`}>
        <ProfileAvatarVisual rawAvatar={rawAvatar} alt={userId} className="h-full w-full object-cover" />
      </div>
    );
  }

  const avatarSrc = resolveProfileAsset(rawAvatar ?? undefined);
  return <Avatar name={userId} src={avatarSrc ?? undefined} size={size} className={`shrink-0 ${className}`} />;
}
