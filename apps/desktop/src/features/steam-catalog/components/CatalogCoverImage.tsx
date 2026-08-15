import { useCallback, useEffect, useMemo, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { Skeleton } from "@heroui/react";
import { globalFailedImages, globalLoadedImages } from "@hooks/useGameMedia";

export interface CatalogCoverImageProps {
  alt: string;
  candidates: readonly string[];
  className?: string;
  fallbackClassName?: string;
  fallbackTitle?: string;
  showSkeleton?: boolean;
  onLoad?: () => void;
  onError?: () => void;
}

/**
 * Imagen de portada con cadena de fallback multinivel, caché global en memoria,
 * transición suave y protección contra iconos de error 404 del navegador.
 */
export function CatalogCoverImage({
  alt,
  candidates,
  className = "h-full w-full object-cover",
  fallbackClassName = "flex h-full w-full flex-col items-center justify-center p-4 bg-[#0e0f14] text-center gap-1.5 rounded-xl border border-zinc-800/20",
  fallbackTitle,
  showSkeleton = false,
  onLoad,
  onError,
}: CatalogCoverImageProps) {
  const validCandidates = useMemo(() => {
    const unique = [...new Set(candidates.filter((u): u is string => Boolean(u && u.trim())))];
    return unique.filter((url) => !globalFailedImages.has(url));
  }, [candidates]);

  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [validCandidates]);

  const activeUrl = validCandidates[candidateIndex] ?? null;

  const [isLoaded, setIsLoaded] = useState(() => (activeUrl ? globalLoadedImages.has(activeUrl) : false));

  useEffect(() => {
    if (activeUrl && globalLoadedImages.has(activeUrl)) {
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }
  }, [activeUrl]);

  const handleImageLoad = useCallback(() => {
    if (activeUrl) {
      globalLoadedImages.add(activeUrl);
    }
    setIsLoaded(true);
    onLoad?.();
  }, [activeUrl, onLoad]);

  const handleImageError = useCallback(() => {
    if (activeUrl) {
      globalFailedImages.add(activeUrl);
    }
    setIsLoaded(false);
    setCandidateIndex((prev) => prev + 1);
    onError?.();
  }, [activeUrl, onError]);

  if (!activeUrl || candidateIndex >= validCandidates.length) {
    return (
      <div className={fallbackClassName} aria-hidden>
        <Gamepad2 size={32} className="text-zinc-600 shrink-0" strokeWidth={1.5} />
        {fallbackTitle ? (
          <span className="text-[10px] font-bold text-zinc-400 select-none line-clamp-2 px-1">{fallbackTitle}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative size-full overflow-hidden bg-zinc-950 rounded-xl">
      {showSkeleton && !isLoaded ? <Skeleton className="absolute inset-0 z-10 size-full rounded-xl" /> : null}
      <img
        key={activeUrl}
        src={activeUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={`${className} transition-opacity duration-200 ease-out select-none ${
          isLoaded ? "opacity-100" : "opacity-0"
        }`}
        onLoad={handleImageLoad}
        onError={handleImageError}
      />
    </div>
  );
}
