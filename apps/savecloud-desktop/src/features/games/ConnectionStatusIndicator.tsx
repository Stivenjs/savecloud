import { Spinner } from "@heroui/react";
import { RefreshCw } from "lucide-react";
import type { ConnectionStatus } from "@hooks/useLastSyncInfo";

interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
}

export function ConnectionStatusIndicator({ status }: ConnectionStatusIndicatorProps) {
  const getStatusConfig = () => {
    switch (status) {
      case "connected":
        return {
          color: "success" as const,
          icon: "●",
          text: "Conectado",
        };
      case "connecting":
        return {
          color: "default" as const,
          icon: <Spinner size="sm" color="primary" />,
          text: "Conectando...",
        };
      case "error":
        return {
          color: "danger" as const,
          icon: "●",
          text: "Sin conexión",
        };
      case "retrying":
        return {
          color: "warning" as const,
          icon: <RefreshCw size={12} className="animate-spin" />,
          text: "Reintentando...",
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
