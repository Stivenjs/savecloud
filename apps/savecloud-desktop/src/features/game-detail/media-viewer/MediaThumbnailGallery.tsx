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
      // Para video, usamos la primera imagen como thumbnail si está disponible
      thumbnailUrl: imageUrls[0],
      alt: "Trailer del juego",
    });
  }

  // Imágenes como elementos siguientes
  imageUrls.forEach((url, index) => {
    items.push({
      id: `image-${index}`,
      type: "image" as MediaItemType,
      url,
      thumbnailUrl: url,
      alt: `Captura ${index + 1}`,
    });
  });

  return items;
}
