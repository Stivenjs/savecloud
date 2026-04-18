import Avatar from "react-nice-avatar";
import { parseLegacyNiceAvatarHtml, parseNiceAvatarConfig } from "@features/profile/niceAvatar";
import { resolveProfileAsset } from "@utils/profileMedia";

interface ProfileAvatarVisualProps {
  rawAvatar: string | null | undefined;
  alt: string;
  className?: string;
}

export function ProfileAvatarVisual({
  rawAvatar,
  alt,
  className = "size-full object-cover",
}: ProfileAvatarVisualProps) {
  const niceAvatarConfig = parseNiceAvatarConfig(rawAvatar);
  if (niceAvatarConfig) {
    return <Avatar className={className} shape="square" {...niceAvatarConfig} />;
  }

  const legacyHtml = parseLegacyNiceAvatarHtml(rawAvatar);
  if (legacyHtml) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: legacyHtml }} aria-label={alt} />;
  }

  const asset = resolveProfileAsset(rawAvatar);
  if (!asset) return null;

  return <img src={asset} alt={alt} decoding="async" className={className} />;
}
