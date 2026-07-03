import { Spinner } from "@heroui/react";
import { RefreshCw } from "lucide-react";
import type { ConnectionStatus } from "@hooks/useLastSyncInfo";
import { useTranslation } from "react-i18next";

interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
}

export function ConnectionStatusIndicator({ status }: ConnectionStatusIndicatorProps) {
  const { t } = useTranslation();

  const getStatusConfig = () => {
    switch (status) {
      case "connected":
        return {
          color: "success" as const,
          icon: "●",
          text: t("common.connection.online"),
        };
      case "connecting":
        return {
          color: "default" as const,
          icon: <Spinner size="sm" color="primary" />,
          text: t("common.connection.connecting"),
        };
      case "error":
        return {
          color: "danger" as const,
          icon: "●",
          text: t("common.connection.offline"),
        };
      case "retrying":
        return {
          color: "warning" as const,
          icon: <RefreshCw size={12} className="animate-spin" />,
          text: t("common.connection.retrying"),
        };
      default:
        return null;
    }
  };

  const config = getStatusConfig();
  if (!config) return null;

  return (
    <div className="flex items-center gap-1">
      <span className={`text-xs text-${config.color}`}>{config.icon}</span>
      <span className={`text-xs text-${config.color}`}>{config.text}</span>
    </div>
  );
}
