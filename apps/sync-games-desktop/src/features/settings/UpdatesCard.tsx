import { Button, Card, CardBody } from "@heroui/react";
import { Package } from "lucide-react";

interface UpdatesCardProps {
  checkingUpdate: boolean;
  onCheckUpdates: () => void | Promise<void>;
}

export function UpdatesCard({
  checkingUpdate,
  onCheckUpdates,
}: UpdatesCardProps) {
  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center gap-2">
          <Package size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">
            Actualizaciones
          </h2>
        </div>
        <p className="text-sm text-default-500">
          Comprueba si hay una nueva versión de la app. Si existe, se te
          ofrecerá descargarla e instalarla.
        </p>
        <Button
          size="sm"
          variant="flat"
          onPress={onCheckUpdates}
          isLoading={checkingUpdate}
        >
          Buscar actualizaciones
        </Button>
      </CardBody>
    </Card>
  );
}

