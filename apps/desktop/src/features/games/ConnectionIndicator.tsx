import { Spinner } from "@heroui/react";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "@hooks/useLastSyncInfo";

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
  error?: string | null;
  onRetry?: () => void;
}

export function ConnectionIndicator({ status, error, onRetry }: ConnectionIndicatorProps) {
  if (status === "idle") return null;

  const config = {
    connecting: {
      icon: <Spinner size="sm" color="primary" />,
      label: "Conectando...",
      className: "text-default-500",
    },
    connected: {
      icon: <Wifi size={14} className="text-success" />,
      label: "Conectado",
      className: "text-success",
    },
    error: {
      icon: <WifiOff size={14} className="text-danger" />,
      label: "Sin conexión",
      className: "text-danger",
    },
    retrying: {
      icon: <RefreshCw size={14} className="animate-spin text-warning" />,
      label: "Reintentando...",
      className: "text-warning",
    },
  };

  const { icon, label, className } = config[status];

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-default-200 bg-default-50 px-3 py-1.5 text-sm dark:bg-default-100/50 ${className}`}
      title={status === "error" && error ? error : undefined}>
      {icon}
      <span>{label}</span>
      {status === "error" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 rounded p-0.5 hover:bg-default-200"
          aria-label="Reintentar conexión">
          <RefreshCw size={12} />
        </button>
      )}
    </div>
  );
}
