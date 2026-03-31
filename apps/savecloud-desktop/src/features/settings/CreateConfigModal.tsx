import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";

interface CreateConfigModalProps {
  isOpen: boolean;
  apiBaseUrl: string;
  apiKey: string;
  userId: string;
  steamWebApiKey: string;
  error: string | null;
  creating: boolean;
  onApiBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onUserIdChange: (value: string) => void;
  onSteamWebApiKeyChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (restoreAfter: boolean) => void | Promise<void>;
}

export function CreateConfigModal({
  isOpen,
  apiBaseUrl,
  apiKey,
  userId,
  steamWebApiKey,
  error,
  creating,
  onApiBaseUrlChange,
  onApiKeyChange,
  onUserIdChange,
  onSteamWebApiKeyChange,
  onClose,
  onSubmit,
}: CreateConfigModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      placement="center"
      size="lg">
      <ModalContent>
        <ModalHeader>Configurar conexión a la nube</ModalHeader>
        <ModalBody className="gap-4">
          <p className="text-sm text-default-500">
            Introduce los datos de acceso para conectarte a tu servidor de SaveCloud. Si estás configurando un PC nuevo,
            elige &quot;Guardar y recuperar de la nube&quot; al terminar para descargar tu configuración respaldada.
          </p>
          <Input
            label="URL de la API (apiBaseUrl)"
            placeholder="https://tu-api.ejemplo.com"
            value={apiBaseUrl}
            onValueChange={onApiBaseUrlChange}
            variant="bordered"
          />
          <Input
            label="Usuario (ID)"
            placeholder="Ej: gabi21"
            value={userId}
            onValueChange={onUserIdChange}
            variant="bordered"
          />
          <Input
            label="API Key (apiKey)"
            placeholder="tu-api-key"
            type="password"
            value={apiKey}
            onValueChange={onApiKeyChange}
            variant="bordered"
          />
          <div className="space-y-2">
            <Input
              label="Clave de Steam (opcional)"
              placeholder="Para el listado de juegos en el catálogo"
              description="Se guarda en el almacén seguro del sistema, no en config.json."
              type="password"
              value={steamWebApiKey}
              onValueChange={onSteamWebApiKeyChange}
              variant="bordered"
            />
            <Button
              size="sm"
              variant="light"
              className="min-w-0 px-0 text-default-500"
              startContent={<ExternalLink size={14} />}
              onPress={() => void openUrl("https://steamcommunity.com/dev/apikey")}>
              Crear o ver tu clave en steamcommunity.com
            </Button>
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            Cancelar
          </Button>
          <Button color="primary" variant="flat" onPress={() => onSubmit(false)} isLoading={creating}>
            Solo guardar
          </Button>
          <Button color="secondary" onPress={() => onSubmit(true)} isLoading={creating}>
            Guardar y recuperar de la nube
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
