import { Button, Card, CardBody } from "@heroui/react";
import { Bell } from "lucide-react";

interface NotificationsCardProps {
  testingNotification: boolean;
  onTestNotification: () => void | Promise<void>;
}

export function NotificationsCard({ testingNotification, onTestNotification }: NotificationsCardProps) {
  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center gap-2">
          <Bell size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">Notificaciones</h2>
        </div>
        <p className="text-sm text-default-500">
          Si la app no está visible (minimizada u otra ventana delante), se mostrará una notificación al terminar una
          subida, descarga o backup completo, o si ocurre un error. Usa el botón para comprobar permisos.
        </p>
        <Button size="sm" variant="flat" onPress={onTestNotification} isLoading={testingNotification}>
          Probar notificación
        </Button>
      </CardBody>
    </Card>
  );
}
