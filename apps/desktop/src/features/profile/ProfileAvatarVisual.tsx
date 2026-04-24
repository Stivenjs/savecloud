import Avatar from "react-nice-avatar";
import { parseLegacyNiceAvatarHtml, parseNiceAvatarConfig } from "@features/profile/niceAvatar";
import { resolveProfileAsset, isProfileVideoSource } from "@utils/profileMedia";

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

  // Soporte video (mp4, webm, etc)
  if (isProfileVideoSource(rawAvatar)) {
    return (
      <video
        src={asset}
        className={className + " object-cover object-center"}
        autoPlay
        muted
        loop
        playsInline
        preload="none"
        aria-label={alt}
        tabIndex={-1}
        draggable={false}
      />
    );
  }

  // GIF animado: <img> ya lo soporta nativamente
  return <img src={asset} alt={alt} decoding="async" className={className} />;
}
