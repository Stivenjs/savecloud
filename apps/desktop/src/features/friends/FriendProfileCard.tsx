import { Button, Card, CardBody, Input } from "@heroui/react";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";

interface FriendProfileCardProps {
  friendIdInput: string;
  onFriendIdChange: (value: string) => void;
  onLoadPress: () => void;
  loading: boolean;
  error: string | null;
}

export function FriendProfileCard({
  friendIdInput,
  onFriendIdChange,
  onLoadPress,
  loading,
  error,
}: FriendProfileCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">{t("friends.tabs.searchUser")}</h2>
        </div>
        <p className="text-sm text-default-600">{t("friends.profileCard.desc")}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input
            label={t("friends.profileCard.label")}
            placeholder={t("friends.profileCard.placeholder")}
            value={friendIdInput}
            onValueChange={onFriendIdChange}
            variant="bordered"
            className="sm:max-w-xs"
            isClearable
            onClear={() => onFriendIdChange("")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onLoadPress();
              }
            }}
          />
          <Button color="primary" onPress={onLoadPress} isLoading={loading} startContent={<Users size={18} />}>
            {t("friends.profileCard.loadButton")}
          </Button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </CardBody>
    </Card>
  );
}
