import { Play } from "lucide-react";

export type MediaItemType = "video" | "image";

export interface MediaItem {
  id: string;
  type: MediaItemType;
  url: string;
  thumbnailUrl?: string;
  alt?: string;
}

interface MediaThumbnailProps {
  item: MediaItem;
  isActive: boolean;
  index: number;
  onClick: () => void;
}

/**
 * Componente de thumbnail para la galería de media.
 * Estilo tipo Steam: muestra imágenes o el video con indicador de play.
 */
export function MediaThumbnail({ item, isActive, index, onClick }: MediaThumbnailProps) {
  const isVideo = item.type === "video";

  return (
    <button
      onClick={onClick}
      className={`
        group relative aspect-video h-20 shrink-0 snap-start overflow-hidden rounded-xl
        cursor-pointer transition-all duration-200 ease-out
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background
        ${
          isActive
            ? "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg"
            : "opacity-80 hover:opacity-100 hover:ring-1 hover:ring-default-200 hover:shadow-md"
        }
      `}
      aria-label={isVideo ? `Video ${index + 1}` : `Imagen ${index + 1}`}
      aria-pressed={isActive}>
      {/* Thumbnail image */}
      <img
        src={item.thumbnailUrl || item.url}
        alt={item.alt || (isVideo ? `Video thumbnail ${index + 1}` : `Imagen ${index + 1}`)}
        className="size-full object-cover"
        loading="lazy"
        decoding="async"
      />

      {/* Video indicator overlay */}
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 transition-colors group-hover:bg-black/50">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow-xl transition-all group-hover:scale-110 group-active:scale-95">
            <Play size={16} className="ml-0.5 text-black" fill="currentColor" />
          </div>
        </div>
      )}

      {/* Active indicator */}
      {isActive && (
        <div className="absolute inset-0 rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background" />
      )}
    </button>
  );
}
