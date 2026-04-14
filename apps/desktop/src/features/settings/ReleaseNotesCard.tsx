import { Button, Card, CardBody } from "@heroui/react";
import { FileText } from "lucide-react";

interface ReleaseNotesCardProps {
  onOpenNotes: () => void;
}

export function ReleaseNotesCard({ onOpenNotes }: ReleaseNotesCardProps) {
  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center gap-2">
          <FileText size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">Notas de versión</h2>
        </div>
        <p className="text-sm text-default-500">Consulta el historial de cambios y novedades de la aplicación.</p>
        <Button size="sm" variant="flat" onPress={onOpenNotes}>
          Ver notas de versión
        </Button>
      </CardBody>
    </Card>
  );
}
