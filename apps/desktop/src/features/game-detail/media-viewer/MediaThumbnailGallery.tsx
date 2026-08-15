import { MediaThumbnail, MediaItem, MediaItemType } from "@/features/game-detail/media-viewer/MediaThumbnail";

interface MediaThumbnailGalleryProps {
  items: MediaItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

/**
 * Galería de thumbnails tipo Steam para navegar entre video e imágenes.
 * Muestra los elementos en una fila horizontal scrollable.
 */
export function MediaThumbnailGallery({ items, activeIndex, onSelect }: MediaThumbnailGalleryProps) {
  const hasMultipleItems = items.length > 1;

  if (!hasMultipleItems) {
    return null;
  }

  return (
    <div className="relative">
      <div
        className="flex gap-3 pb-3 pt-1 px-1 snap-x snap-mandatory overflow-x-auto"
        role="tablist"
        aria-label="Navegación de media">
        {items.map((item, index) => (
          <MediaThumbnail
            key={item.id}
            item={item}
            isActive={index === activeIndex}
            index={index}
            onClick={() => onSelect(index)}
          />
        ))}
      </div>

      {/* Gradient fade indicators for scroll hint */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-linear-to-l from-background to-transparent cursor-pointer" />
    </div>
  );
}

/**
 * Obtiene la versión optimizada para thumbnail de una captura de Steam (600x338 en vez de 1920x1080).
 */
export function getSteamThumbnailUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.includes(".1920x1080.")) {
    return url.replace(".1920x1080.", ".600x338.");
  }
  return url;
}

/**
 * Utilidad para construir items de media a partir de URLs.
 */
export function buildMediaItems(videoUrl: string | null | undefined, imageUrls: string[]): MediaItem[] {
  const items: MediaItem[] = [];

  // Video como primer elemento (si existe)
  if (videoUrl?.trim()) {
    items.push({
      id: "video-0",
      type: "video" as MediaItemType,
      url: videoUrl,
      thumbnailUrl: getSteamThumbnailUrl(imageUrls[0]),
      alt: "Trailer del juego",
    });
  }

  // Imágenes como elementos siguientes
  imageUrls.forEach((url, index) => {
    items.push({
      id: `image-${index}`,
      type: "image" as MediaItemType,
      url,
      thumbnailUrl: getSteamThumbnailUrl(url),
      alt: `Captura ${index + 1}`,
    });
  });

  return items;
}
