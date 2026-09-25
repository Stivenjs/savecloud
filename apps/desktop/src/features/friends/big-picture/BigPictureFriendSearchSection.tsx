import { Button, Input } from "@heroui/react";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";

interface BigPictureFriendSearchSectionProps {
  friendIdInput: string;
  onFriendIdChange: (value: string) => void;
  onLoadPress: () => void;
  loading: boolean;
  error: string | null;
}

/**
 * Sección de búsqueda de amigo por usuario optimizada para Big Picture.
 *
 * Input y botón grandes, texto legible desde distancia de sofá.
 * Descripción simplificada (la versión desktop tiene un párrafo enorme).
 */
export function BigPictureFriendSearchSection({
  friendIdInput,
  onFriendIdChange,
  onLoadPress,
  loading,
  error,
}: BigPictureFriendSearchSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-default-200/60 bg-default-50/40 px-6 py-6 dark:border-default-100/15 dark:bg-default-50/6 sm:px-8 sm:py-7">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex size-10 items-center justify-center rounded-xl bg-default-100 dark:bg-default-50/15">
          <Users size={22} className="text-default-600" />
        </div>
        <h2 className="text-lg font-bold text-foreground md:text-xl">{t("friends.bigPictureSearch.title")}</h2>
      </div>
      <p className="mb-5 text-sm text-default-400 md:text-base leading-relaxed max-w-2xl">
        {t("friends.bigPictureSearch.desc")}
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Input
          label={t("friends.profileCard.label")}
          placeholder={t("friends.profileCard.placeholder")}
          value={friendIdInput}
          onValueChange={onFriendIdChange}
          variant="bordered"
          size="lg"
          isClearable
          onClear={() => onFriendIdChange("")}
          onKeyDown={(e) => {
            if (e.key === "Enter") onLoadPress();
          }}
          classNames={{
            base: "sm:max-w-sm",
            input: "text-base",
            label: "text-sm md:text-base",
          }}
        />
        <Button
          size="lg"
          color="primary"
          onPress={onLoadPress}
          isLoading={loading}
          startContent={!loading ? <Users size={20} /> : undefined}
          className="h-12 px-6 text-base font-semibold rounded-xl">
          {t("friends.profileCard.loadButton")}
        </Button>
      </div>
      {error ? <p className="mt-4 text-base text-danger">{error}</p> : null}
    </div>
  );
}
