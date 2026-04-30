import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Cloud, ExternalLink, KeyRound, UserRound, Wifi } from "lucide-react";

interface CreateConfigModalProps {
  isOpen: boolean;
  apiBaseUrl: string;
  wsBaseUrl: string;
  apiKey: string;
  userId: string;
  steamWebApiKey: string;
  error: string | null;
  creating: boolean;
  onApiBaseUrlChange: (value: string) => void;
  onWsBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onUserIdChange: (value: string) => void;
  onSteamWebApiKeyChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (restoreAfter: boolean) => void | Promise<void>;
}

export function CreateConfigModal({
  isOpen,
  apiBaseUrl,
  wsBaseUrl,
  apiKey,
  userId,
  steamWebApiKey,
  error,
  creating,
  onApiBaseUrlChange,
  onWsBaseUrlChange,
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
        <ModalHeader className="flex flex-col gap-1 pb-2">
          <span className="text-base font-semibold text-default-900">Configurar conexión a la nube</span>
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-primary">Paso 1 de 1</span>
        </ModalHeader>
        <ModalBody className="gap-5 pb-2">
          <p className="rounded-large border border-default-200 bg-default-50 px-3 py-2 text-sm text-default-600 dark:border-default-100/10 dark:bg-default-100/5 dark:text-default-400">
            Completa estos datos una sola vez para conectar la app con tu servidor de SaveCloud.
            <br />
            Si este es un PC nuevo, usa &quot;Guardar y recuperar de la nube&quot; para restaurar tu configuración al
            final.
          </p>
          <div className="space-y-3 rounded-xl border border-default-200 bg-content1 p-3 dark:border-default-100/10">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-default-500">Conexión principal</p>
            <Input
              label="Dirección del servidor API"
              placeholder="https://tu-api.ejemplo.com"
              description="URL base donde corre tu backend de SaveCloud."
              startContent={<Cloud size={14} className="text-default-400" />}
              value={apiBaseUrl}
              onValueChange={onApiBaseUrlChange}
              variant="bordered"
            />
            <Input
              label="Dirección de WebSocket"
              placeholder="wss://tu-api.ejemplo.com/dev"
              description="Se usa para funciones en tiempo real, por ejemplo estado de amigos."
              startContent={<Wifi size={14} className="text-default-400" />}
              value={wsBaseUrl}
              onValueChange={onWsBaseUrlChange}
              variant="bordered"
            />
          </div>
          <div className="space-y-3 rounded-xl border border-default-200 bg-content1 p-3 dark:border-default-100/10">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-default-500">Credenciales</p>
            <Input
              label="ID de usuario"
              placeholder="Ej: gabi21"
              description="Es el identificador de tu cuenta en el servidor."
              startContent={<UserRound size={14} className="text-default-400" />}
              value={userId}
              onValueChange={onUserIdChange}
              variant="bordered"
            />
            <Input
              label="Clave de acceso (API Key)"
              placeholder="Pega aquí tu API Key"
              description="Tu clave privada para autenticar la conexión con la nube."
              type="password"
              startContent={<KeyRound size={14} className="text-default-400" />}
              value={apiKey}
              onValueChange={onApiKeyChange}
              variant="bordered"
            />
          </div>
          <div className="space-y-2 rounded-xl border border-default-200 bg-content1 p-3 dark:border-default-100/10">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-default-500">Integración opcional</p>
            <Input
              label="Clave de Steam (opcional)"
              placeholder="Solo si quieres sincronizar datos de Steam"
              description="Se guarda en el almacén seguro del sistema, no en config.json."
              type="password"
              value={steamWebApiKey}
              onValueChange={onSteamWebApiKeyChange}
              variant="bordered"
            />
            <Button
              size="sm"
              variant="light"
              className="min-w-0 justify-start px-0 text-default-500"
              startContent={<ExternalLink size={14} />}
              onPress={() => void openUrl("https://steamcommunity.com/dev/apikey")}>
              Obtener mi clave en steamcommunity.com
            </Button>
          </div>
          {error ? (
            <div className="rounded-medium border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-500/40 dark:bg-danger-500/10 dark:text-danger-300">
              No pudimos completar la conexión. Revisa tus datos e inténtalo de nuevo.
              <br />
              <span className="text-xs opacity-80">{error}</span>
            </div>
          ) : null}
        </ModalBody>
        <ModalFooter className="gap-2">
          <Button variant="flat" onPress={onClose} className="font-medium">
            Cancelar
          </Button>
          <Button
            color="primary"
            variant="flat"
            onPress={() => onSubmit(false)}
            isLoading={creating}
            className="font-medium">
            Solo guardar
          </Button>
          <Button color="secondary" onPress={() => onSubmit(true)} isLoading={creating} className="font-semibold">
            Guardar y recuperar de la nube
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
