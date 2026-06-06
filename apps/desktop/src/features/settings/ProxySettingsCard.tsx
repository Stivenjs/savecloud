import { useState } from "react";
import { Button, Card, CardBody, Input } from "@heroui/react";
import { Globe, Save, Trash2 } from "lucide-react";

interface ProxySettingsCardProps {
  proxyUrl: string;
  onProxyUrlChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  busy?: boolean;
}

export function ProxySettingsCard({ proxyUrl, onProxyUrlChange, onSave, busy = false }: ProxySettingsCardProps) {
  const [localBusy, setLocalBusy] = useState(false);

  const handleSave = async () => {
    setLocalBusy(true);
    try {
      await onSave();
    } finally {
      setLocalBusy(false);
    }
  };

  const handleClear = () => {
    onProxyUrlChange("");
  };

  const isSaveDisabled = localBusy || busy;

  return (
    <Card className="shadow-sm">
      <CardBody className="gap-5 p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Globe size={18} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-default-900">Servidor Proxy (HTTP/SOCKS5)</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-default-500">
              Enruta las descargas de hosters (como Gofile o Pixeldrain) y las peticiones a APIs de terceros a través de
              un proxy para evitar limitaciones de IP o bloqueos temporales.
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-default-100" />

        {/* Proxy URL input */}
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-default-600">Dirección del proxy</span>
            <Input
              size="sm"
              placeholder="Ej. socks5://127.0.0.1:1080 o http://127.0.0.1:8080"
              value={proxyUrl}
              onValueChange={onProxyUrlChange}
              isDisabled={isSaveDisabled}
              startContent={<Globe size={13} className="shrink-0 text-default-400" />}
              classNames={{
                input: "text-xs",
                inputWrapper: "h-9",
              }}
            />
            <span className="text-[10px] text-default-400">
              Esquemas soportados: <code>http://</code>, <code>https://</code>, <code>socks5://</code>,{" "}
              <code>socks5h://</code> (SOCKS5 DNS local/remoto). Dejar vacío para desactivar.
            </span>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              color="primary"
              variant="flat"
              isLoading={isSaveDisabled}
              onPress={handleSave}
              startContent={!isSaveDisabled && <Save size={13} />}
              className="h-8 text-xs font-medium">
              Guardar proxy
            </Button>
            {proxyUrl && (
              <Button
                size="sm"
                variant="flat"
                color="danger"
                isDisabled={isSaveDisabled}
                onPress={handleClear}
                startContent={<Trash2 size={13} />}
                className="h-8 text-xs font-medium">
                Limpiar campo
              </Button>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
