import { Button, Card, CardBody, Input } from "@heroui/react";
import { Link2 } from "lucide-react";

interface ShareLinkCardProps {
  shareLinkInput: string;
  onShareLinkChange: (value: string) => void;
  onImportPress: () => void;
  loading: boolean;
  disabled: boolean;
}

export function ShareLinkCard({
  shareLinkInput,
  onShareLinkChange,
  onImportPress,
  loading,
  disabled,
}: ShareLinkCardProps) {
  return (
    <Card className="border border-primary-200/50 bg-primary-50/30 dark:border-primary-500/20 dark:bg-primary-500/5">
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Link2 size={20} className="text-primary" />
          <h2 className="text-base font-semibold text-foreground">
            Importar desde link compartido
          </h2>
        </div>
        <p className="text-sm text-default-600">
          Si alguien te envió un <strong>link para compartir</strong> (desde el
          menú ⋮ del juego → &quot;Compartir por link&quot;), pégalo aquí.
          Verás qué archivos se copiarán y podrás confirmar antes de importar a
          tu nube.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            label="URL o código del link"
            placeholder="https://.../share/abc123 o solo el código"
            value={shareLinkInput}
            onValueChange={onShareLinkChange}
            variant="bordered"
            className="sm:max-w-md"
          />
          <Button
            variant="flat"
            color="primary"
            onPress={onImportPress}
            isLoading={loading}
            isDisabled={disabled}
          >
            Ver archivos e importar
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
