import { useNavigationStore } from "@features/input/store";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";

/** Rutas sin página dedicada: atrás (B / Escape) hace pop de capa de foco si aplica. */
export function PlaceholderPage() {
  const popLayer = useNavigationStore((s) => s.popLayer);
  useRegisterGlobalBack(() => {
    switch (true) {
      default:
        popLayer();
        return true;
    }
  });

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <p className="text-default-500">Sección en desarrollo</p>
    </div>
  );
}
