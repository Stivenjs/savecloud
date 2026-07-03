import { Button, Card, CardHeader, CardBody, CardFooter } from "@heroui/react";
import { exportPluginSdk } from "@services/tauri";
import { useState } from "react";
import { toastSuccess, toastError } from "@utils/toast";
import { Download, Code2, AlertTriangle, ScrollText } from "lucide-react";
import { PluginLogsModal } from "@/features/settings/Pluginlogsmodal";
import { useTranslation, Trans } from "react-i18next";

export function DevSdk() {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  const handleExportSdk = async () => {
    setIsExporting(true);

    try {
      const path = await exportPluginSdk();
      if (path) {
        toastSuccess(t("settings.sdk.toastExportSuccess"), t("settings.sdk.toastExportSuccessDesc", { path }));
      }
    } catch (error) {
      if (error !== "CANCELADO") {
        toastError(t("settings.sdk.toastExportError"), t("settings.sdk.toastExportErrorDesc"));
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
            <h3 className="text-lg font-semibold">{t("settings.sdk.title")}</h3>
          </div>

          <p className="text-sm text-default-500 leading-relaxed">
            <Trans
              i18nKey="settings.sdk.desc"
              components={{
                code: <code className="bg-default-100 px-1.5 py-0.5 rounded text-xs font-mono" />,
                strong: <strong />,
              }}
            />
          </p>
        </CardHeader>

        <CardBody className="gap-3">
          <div className="text-sm text-default-600">
            <span className="font-medium">{t("settings.sdk.includes")}</span>{" "}
            <span className="text-default-500">{t("settings.sdk.includesDesc")}</span>
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
              <Trans i18nKey="settings.sdk.warning" components={{ code: <code className="font-mono" /> }} />
            </span>
          </div>
        </CardBody>

        <CardFooter className="flex gap-2">
          <Button
            onPress={handleExportSdk}
            color="primary"
            isLoading={isExporting}
            startContent={!isExporting && <Download size={16} />}>
            {isExporting ? t("settings.sdk.generating") : t("settings.sdk.exportButton")}
          </Button>

          <Button onPress={() => setLogsOpen(true)} variant="flat" startContent={<ScrollText size={16} />}>
            {t("settings.sdk.viewLogs")}
          </Button>
        </CardFooter>
      </Card>

      <PluginLogsModal isOpen={logsOpen} onClose={() => setLogsOpen(false)} />
    </>
  );
}
