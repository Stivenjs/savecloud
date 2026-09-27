import type { ReactNode } from "react";
import { useAppInitialization } from "@hooks/useAppInitialization";

/** Inicializa los servicios globales en la ventana independiente del visor. */
export function StreamViewerRuntime({ children }: { children: ReactNode }) {
  useAppInitialization();
  return children;
}
