import { useTranslation } from "react-i18next";

interface BigPictureFriendsHeaderProps {
  /** Conteo de invitaciones pendientes, si se desea mostrar en la cabecera. */
  pendingInvitesCount?: number;
}

/**
 * Cabecera simplificada para la página Social en modo Big Picture.
 *
 * Usa tamaños grandes legibles desde distancia de sofá, sin Chip ni
 * descripciones densas del modo escritorio.
 */
export function BigPictureFriendsHeader({ pendingInvitesCount = 0 }: BigPictureFriendsHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="mt-4 flex flex-col gap-2 sm:mt-6">
      <div className="flex flex-wrap items-center gap-3 gap-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-[1.875rem]">{t("nav.social")}</h1>
          {pendingInvitesCount > 0 ? (
            <span className="rounded-full bg-primary/20 px-3 py-1 text-sm font-medium text-primary">
              {t("friends.invitesTab.statsPending", { count: pendingInvitesCount })}
            </span>
          ) : null}
        </div>
      </div>
      <p className="text-sm text-default-400 md:text-base">{t("friends.bigPictureHeader.desc")}</p>
    </div>
  );
}
