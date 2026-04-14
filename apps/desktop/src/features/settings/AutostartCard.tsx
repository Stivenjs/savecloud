import { Card, CardBody, Switch } from "@heroui/react";
import { Power } from "lucide-react";

interface AutostartCardProps {
  autostart: boolean;
  loading: boolean;
  onChange: (checked: boolean) => void;
}

export function AutostartCard({ autostart, loading, onChange }: AutostartCardProps) {
  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Power size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Iniciar con Windows</h2>
              <p className="mt-0.5 text-sm text-default-500">
                Abre la app automáticamente al iniciar sesión en el equipo, para que los guardados se sincronicen en
                segundo plano.
              </p>
            </div>
          </div>
          <Switch isSelected={autostart} onValueChange={onChange} isDisabled={loading} />
        </div>
      </CardBody>
    </Card>
  );
}
