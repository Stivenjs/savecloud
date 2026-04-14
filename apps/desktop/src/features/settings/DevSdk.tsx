import { Button, Card, CardHeader, CardBody, CardFooter } from "@heroui/react";
import { exportPluginSdk } from "@services/tauri";
import { useState } from "react";
import { toastSuccess, toastError } from "@utils/toast";
import { Download, Code2, AlertTriangle, ScrollText } from "lucide-react";
import { PluginLogsModal } from "@/features/settings/Pluginlogsmodal";

export function DevSdk() {
  const [isExporting, setIsExporting] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  const handleExportSdk = async () => {
    setIsExporting(true);

    try {
      const path = await exportPluginSdk();
      if (path) {
        toastSuccess("SDK exportado con éxito", `Guardado en: ${path}`);
      }
    } catch (error) {
      if (error !== "CANCELADO") {
        toastError(
          "Error al exportar SDK",
          "Hubo un problema al generar el archivo. Verifica los permisos de la carpeta."
        );
      }
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <Card className="p-2">
        <CardHeader className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            <Code2 size={18} className="text-primary" />
            <h3 className="text-lg font-semibold">Entorno de Desarrollo para Plugins (SDK)</h3>
          </div>

          <p className="text-sm text-default-500 leading-relaxed">
            Descarga las definiciones de la API de SaveCloud (
            <code className="bg-default-100 px-1.5 py-0.5 rounded text-xs font-mono">savecloud-api.lua</code>
            ). Este archivo <strong>no se ejecuta</strong>, solo proporciona <strong>autocompletado y tipado</strong>.
          </p>
        </CardHeader>

        <CardBody className="gap-3">
          <div className="text-sm text-default-600">
            <span className="font-medium">Incluye:</span>{" "}
            <span className="text-default-500">log, ui, db (API disponible para plugins)</span>
          </div>

          <div className="rounded-lg bg-default-100 p-3 font-mono text-xs text-default-700">
            <div>---@class SaveCloudCore</div>
            <div>---@field log SaveCloudLog</div>
            <div>---@field ui SaveCloudUI</div>
            <div>---@field db SaveCloudDB</div>
            <div className="mt-2">savecloud = {"{}"} ---@type SaveCloudCore</div>
          </div>

          <div className="flex items-center gap-2 text-xs text-warning-600">
            <AlertTriangle size={14} />
            <span>
              Debes colocarlo junto a tu archivo <code className="font-mono">init.lua</code>
            </span>
          </div>
        </CardBody>

        <CardFooter className="flex gap-2">
          <Button
            onPress={handleExportSdk}
            color="primary"
            isLoading={isExporting}
            startContent={!isExporting && <Download size={16} />}>
            {isExporting ? "Generando..." : "Exportar SDK (Lua)"}
          </Button>

          <Button onPress={() => setLogsOpen(true)} variant="flat" startContent={<ScrollText size={16} />}>
            Ver logs
          </Button>
        </CardFooter>
      </Card>

      <PluginLogsModal isOpen={logsOpen} onClose={() => setLogsOpen(false)} />
    </>
  );
}
