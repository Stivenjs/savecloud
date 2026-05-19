import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen } from "lucide-react";

export interface CatalogCoverImageProps {
  alt: string;
  candidates: readonly string[];
  className?: string;
  fallbackClassName?: string;
}

/**
 * Imagen de portada con cadena de fallback cuando Steam CDN devuelve 404.
 */
export function CatalogCoverImage({
  alt,
  candidates,
  className = "h-full w-full object-cover",
  fallbackClassName = "flex h-full w-full items-center justify-center text-default-400",
}: CatalogCoverImageProps) {
  const uniqueCandidates = useMemo(() => [...new Set(candidates.filter(Boolean))], [candidates]);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setFailedUrls(new Set());
  }, [uniqueCandidates]);

  const activeUrl = uniqueCandidates.find((url) => !failedUrls.has(url)) ?? null;

  const handleError = useCallback(() => {
    if (!activeUrl) return;
    setFailedUrls((prev) => {
      if (prev.has(activeUrl)) return prev;
      const next = new Set(prev);
      next.add(activeUrl);
      return next;
    });
  }, [activeUrl]);

  if (!activeUrl) {
    return (
      <div className={fallbackClassName} aria-hidden>
        <FolderOpen size={32} />
      </div>
    );
  }

  return <img src={activeUrl} alt={alt} className={className} loading="lazy" decoding="async" onError={handleError} />;
}
