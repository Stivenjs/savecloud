import { Chip, Skeleton } from "@heroui/react";
import { useTranslation } from "react-i18next";

export type PresenceStatus = "offline" | "online" | "playing";

interface PresenceStatusChipProps {
  status?: PresenceStatus;
  loading?: boolean;
}

export function PresenceStatusChip({ status, loading = false }: PresenceStatusChipProps) {
  const { t } = useTranslation();

  if (loading) {
    return <Skeleton className="h-5 w-20 rounded-full" />;
  }

  if (status === "playing") {
    return (
      <Chip size="sm" variant="flat" color="success">
        {t("friends.presence.playing")}
      </Chip>
    );
  }

  if (status === "online") {
    return (
      <Chip size="sm" variant="flat" color="primary">
        {t("friends.presence.online")}
      </Chip>
    );
  }

  if (status === "offline") {
    return (
      <Chip size="sm" variant="flat" color="default">
        {t("friends.presence.noConnection")}
      </Chip>
    );
  }

  return (
    <Chip size="sm" variant="flat" color="default">
      {t("friends.presence.unknown")}
    </Chip>
  );
}
