import { Button, Card, CardBody, Input } from "@heroui/react";
import type { SourceCatalogSummary } from "@services/tauri/sources.service";
import { getSourceDisplayName } from "@utils/format";

type Props = {
  sourceUrl: string;
  defaultDownloadDir: string;
  sourcesBusy: boolean;
  sources: SourceCatalogSummary[];
  onSourceUrlChange: (value: string) => void;
  onDefaultDownloadDirChange: (value: string) => void;
  onImportUrl: () => void;
  onImportFile: () => void;
  onPickFolder: () => void;
  onSaveDefaultDir: () => void;
};

export function SourceInstallSettingsCard(props: Props) {
  return (
    <Card>
      <CardBody className="gap-3">
        <div>
          <h3 className="text-base font-semibold">Instalacion desde fuentes</h3>
          <p className="text-xs text-default-500">
            Importa JSONs (URL o archivo) y define la carpeta destino por defecto para instalar desde el catalogo.
          </p>
        </div>
        <div className="text-xs text-default-500">
          Fuentes importadas: <span className="font-semibold">{props.sources.length}</span> · Descargas totales:{" "}
          <span className="font-semibold">{props.sources.reduce((acc, s) => acc + s.downloadsCount, 0)}</span>
        </div>
        <Input
          label="URL de fuente JSON"
          placeholder="https://hydralinks.cloud/sources/fitgirl.json"
          value={props.sourceUrl}
          onValueChange={props.onSourceUrlChange}
          isDisabled={props.sourcesBusy}
        />
        <div className="flex flex-wrap gap-2">
          <Button color="primary" isLoading={props.sourcesBusy} onPress={props.onImportUrl}>
            Importar desde URL
          </Button>
          <Button variant="flat" isLoading={props.sourcesBusy} onPress={props.onImportFile}>
            Importar archivo JSON
          </Button>
        </div>
        {props.sources.length > 0 ? (
          <div className="rounded-medium border border-default-200 p-2">
            <p className="mb-2 text-xs font-semibold text-default-600">JSON importados</p>
            <div className="max-h-36 space-y-1 overflow-auto">
              {props.sources.map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-default-700">{getSourceDisplayName(source.sourceUrl ?? "")}</span>
                  <span className="shrink-0 text-default-500">{source.downloadsCount} juegos</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <Input
          label="Carpeta por defecto para descargas"
          placeholder="D:/Games/Downloads"
          value={props.defaultDownloadDir}
          onValueChange={props.onDefaultDownloadDirChange}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="flat" onPress={props.onPickFolder}>
            Elegir carpeta
          </Button>
          <Button color="primary" onPress={props.onSaveDefaultDir}>
            Guardar ruta
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
