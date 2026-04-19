import { Chip, Skeleton } from "@heroui/react";

export type PresenceStatus = "offline" | "online" | "playing";

interface PresenceStatusChipProps {
  status?: PresenceStatus;
  loading?: boolean;
}

export function PresenceStatusChip({ status, loading = false }: PresenceStatusChipProps) {
  if (loading) {
    return <Skeleton className="h-5 w-20 rounded-full" />;
  }

  if (status === "playing") {
    return (
      <Chip size="sm" variant="flat" color="success">
        jugando
      </Chip>
    );
  }

  if (status === "online") {
    return (
      <Chip size="sm" variant="flat" color="primary">
        en linea
      </Chip>
    );
  }

  if (status === "offline") {
    return (
      <Chip size="sm" variant="flat" color="default">
        sin conexion
      </Chip>
    );
  }

  return (
    <Chip size="sm" variant="flat" color="default">
      desconocido
    </Chip>
  );
}
