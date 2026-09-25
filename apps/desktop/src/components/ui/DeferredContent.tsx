import { useEffect, useState, type ReactNode } from "react";

interface DeferredContentProps {
  children: ReactNode;
  /** Fallback ligero mientras se cede el frame de renderizado */
  fallback?: ReactNode;
  /** Retraso adicional en milisegundos tras el primer RAF (por defecto 0 para ceder 1 frame) */
  delayMs?: number;
}

/**
 * Renderiza su contenido de forma diferida tras permitir que el hilo principal
 * del navegador despache las animaciones iniciales y el primer fotograma (paint).
 */
export function DeferredContent({ children, fallback = null, delayMs = 0 }: DeferredContentProps) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    const raf = requestAnimationFrame(() => {
      if (delayMs > 0) {
        const timer = setTimeout(() => {
          if (!isCancelled) setIsReady(true);
        }, delayMs);
        return () => clearTimeout(timer);
      }
      if (!isCancelled) setIsReady(true);
    });

    return () => {
      isCancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [delayMs]);

  if (!isReady) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
