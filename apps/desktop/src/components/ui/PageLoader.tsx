import { Spinner } from "@heroui/react";

export function PageLoader() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <Spinner size="lg" color="primary" label="Cargando..." />
    </div>
  );
}
