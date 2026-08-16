import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Divider, ScrollShadow, Skeleton } from "@heroui/react";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Cloud,
  Code2,
  FolderOpen,
  Gamepad2,
  Layers,
  Search,
  Tags,
  Trophy,
  User,
  Users,
} from "lucide-react";
import type { SteamAppDetailsResult } from "@services/tauri";
import type { ConfiguredGame } from "@app-types/config";
import { resolveSteamSummaryBlurb, stripScriptTags } from "@utils/steamText";
import { useRunCompatibility } from "@hooks/useRunCompatibility";
import { GameDetailRunCompatibility } from "@features/game-detail/GameDetailRunCompatibility";

const STEAM_EMBED_CLASSES = [
  "mr-auto w-full max-w-[min(65ch,100%)] px-4 py-6 text-left sm:px-5 sm:py-7",
  "text-[15px] leading-[1.72] tracking-[0.01em]",
  "text-default-700 selection:bg-primary/15 dark:text-default-300 dark:selection:bg-primary/25",
  // Primer bloque sin margen superior extra
  "[&>*:first-child]:mt-0",
  // Párrafos
  "[&_p]:my-4 [&_p:last-child]:mb-0",
  // Titulares (Steam usa h2 / h3 con frecuencia)
  "[&_h1]:mt-10 [&_h1]:scroll-mt-6 [&_h1]:border-b [&_h1]:border-default-300/55 [&_h1]:pb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:text-foreground dark:[&_h1]:border-default-100/25 [&_h1:first-child]:mt-0",
  "[&_h2]:mt-10 [&_h2]:scroll-mt-6 [&_h2]:border-b [&_h2]:border-default-300/55 [&_h2]:pb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground dark:[&_h2]:border-default-100/25 [&_h2:first-child]:mt-0",
  "[&_h3]:mt-8 [&_h3]:scroll-mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-[0.08em] [&_h3]:text-default-900 dark:[&_h3]:text-default-100 [&_h3:first-child]:mt-0",
  // Imagenes al ancho útil del panel (alineadas con tarjetas de la misma vista)
  "[&_img]:my-7 [&_img]:block [&_img]:max-w-full! [&_img]:h-auto! [&_img]:w-full [&_img]:rounded-xl",
  "[&_img]:border [&_img]:border-default-200/50 [&_img]:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)] dark:[&_img]:border-default-100/25",
  // Enlaces, listas, énfasis
  "[&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 [&_a]:transition-colors hover:[&_a]:underline",
  "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5",
  "[&_ol]:my-4 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5",
  "[&_li]:marker:text-default-400",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:text-default-600 [&_blockquote]:italic dark:[&_blockquote]:text-default-400",
  "[&_hr]:my-8 [&_hr]:border-default-200/70 dark:[&_hr]:border-default-100/20",
  "[&_iframe]:my-6 [&_iframe]:aspect-video [&_iframe]:w-full [&_iframe]:rounded-xl [&_iframe]:border [&_iframe]:border-default-200/50 dark:[&_iframe]:border-default-100/20",
  "[&_table]:my-6 [&_table]:w-full [&_table]:text-left [&_table]:text-sm",
  "[&_th]:border-b [&_th]:border-default-200/70 [&_th]:pb-2 [&_th]:font-semibold dark:[&_th]:border-default-100/20",
  "[&_td]:border-b [&_td]:border-default-200/35 [&_td]:py-2 dark:[&_td]:border-default-100/10",
].join(" ");

/** Etiqueta de sección secundaria (estilo ficha, no tarjeta genérica). */
function FieldLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-default-400">
      {icon}
      {label}
    </span>
  );
}

/** Devuelve un icono temático según el nombre de la categoría de Steam. */
function getCategoryIcon(cat: string): ReactNode {
  const lower = cat.toLowerCase();
  if (lower.includes("mando") || lower.includes("controller") || lower.includes("joystick")) {
    return <Gamepad2 size={13} className="shrink-0 text-primary opacity-90" />;
  }
  if (lower.includes("logro") || lower.includes("achievement")) {
    return <Trophy size={13} className="shrink-0 text-amber-500 opacity-90" />;
  }
  if (lower.includes("nube") || lower.includes("cloud")) {
    return <Cloud size={13} className="shrink-0 text-sky-400 opacity-90" />;
  }
  if (lower.includes("cromo") || lower.includes("card")) {
    return <Layers size={13} className="shrink-0 text-indigo-400 opacity-90" />;
  }
  if (
    lower.includes("multijugador") ||
    lower.includes("multi-player") ||
    lower.includes("cooperativo") ||
    lower.includes("co-op") ||
    lower.includes("en línea") ||
    lower.includes("online")
  ) {
    return <Users size={13} className="shrink-0 text-emerald-500 opacity-90" />;
  }
  if (lower.includes("un jugador") || lower.includes("single-player")) {
    return <User size={13} className="shrink-0 text-secondary opacity-90" />;
  }
  return <Code2 size={13} className="shrink-0 opacity-70" />;
}

interface GameDetailInfoProps {
  details: SteamAppDetailsResult | null;
  isLoading: boolean;
}

/** Contenido de la pestaña Resumen: descripción corta, ficha técnica, géneros y categorías. */
export function GameDetailSummaryPanel({ details }: { details: SteamAppDetailsResult }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const blurb = resolveSteamSummaryBlurb(details);

  const handleGenreClick = (genre: string) => {
    navigate(`/catalog?genre=${encodeURIComponent(genre)}`);
  };

  const hasTechSpecs = details.developers.length > 0 || details.publishers.length > 0 || !!details.releaseDate;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-8 items-start lg:grid-cols-12">
        {/* Columna izquierda: Sinopsis */}
        <div className="space-y-4 lg:col-span-7">
          {blurb ? (
            <div>
              <div className="mb-3 flex flex-col gap-0.5">
                <h3 className="text-lg font-bold tracking-tight text-foreground">{t("library.detail.synopsis")}</h3>
                {blurb.subtitle ? <p className="text-xs text-default-500">{blurb.subtitle}</p> : null}
              </div>
              <div className="border-l-2 border-primary/40 pl-5">
                <p className="whitespace-pre-line text-[15px] leading-[1.7] text-default-700 dark:text-default-300">
                  {blurb.text}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-default-300/70 bg-default-100/20 px-4 py-3.5 dark:border-default-100/25 dark:bg-default-50/10">
              <p className="text-sm leading-relaxed text-default-600 dark:text-default-400">
                {t("library.detail.noShortDescription")}
              </p>
            </div>
          )}
        </div>

        {/* Columna derecha: Ficha técnica, Géneros y Categorías */}
        <div className="space-y-6 lg:col-span-5">
          {/* 1. Ficha Técnica */}
          {hasTechSpecs && (
            <div className="space-y-2.5">
              <FieldLabel
                icon={<Building2 size={14} className="text-primary opacity-90" />}
                label={t("library.detail.techSpecs")}
              />
              <div className="space-y-2 rounded-xl border border-default-200/50 bg-default-100/30 p-3.5 text-xs dark:border-default-100/10 dark:bg-default-50/5">
                {details.releaseDate && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-default-400 font-medium">{t("library.detail.releaseDate")}</span>
                    <span className="font-semibold text-foreground text-right">{details.releaseDate}</span>
                  </div>
                )}
                {details.developers.length > 0 && (
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-default-400 font-medium shrink-0">{t("library.detail.developers")}</span>
                    <span className="font-semibold text-foreground text-right">{details.developers.join(", ")}</span>
                  </div>
                )}
                {details.publishers.length > 0 && (
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-default-400 font-medium shrink-0">{t("library.detail.publishers")}</span>
                    <span className="font-semibold text-foreground text-right">{details.publishers.join(", ")}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. Géneros clicables -> Catálogo */}
          {details.genres.length > 0 && (
            <div className="space-y-2.5">
              <FieldLabel
                icon={<Tags size={14} className="text-primary opacity-90" />}
                label={t("library.detail.genres")}
              />
              <div className="flex flex-wrap gap-2">
                {details.genres.map((genre, idx) => (
                  <button
                    key={`${genre}-${idx}`}
                    type="button"
                    onClick={() => handleGenreClick(genre)}
                    title={`Buscar juegos de ${genre} en el catálogo`}
                    className="group inline-flex items-center gap-1.5 rounded-lg bg-default-200/70 px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-default-300/50 transition-all hover:bg-primary/15 hover:text-primary hover:ring-primary/40 dark:bg-default-100/25 dark:text-default-200 dark:ring-default-100/20 active:scale-95 cursor-pointer">
                    <span>{genre}</span>
                    <Search size={11} className="opacity-40 transition-opacity group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 3. Categorías con iconos contextuales */}
          {details.categories.length > 0 && (
            <div className="space-y-2.5">
              <FieldLabel
                icon={<Code2 size={14} className="text-primary opacity-90" />}
                label={t("library.detail.categories")}
              />
              <div className="flex flex-wrap gap-1.5">
                {details.categories.map((cat, idx) => (
                  <span
                    key={`${cat}-${idx}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-default-100/80 px-2.5 py-1 text-xs text-default-700 ring-1 ring-default-200/60 dark:bg-default-50/20 dark:text-default-300 dark:ring-default-100/15">
                    {getCategoryIcon(cat)}
                    <span>{cat}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Ficha técnica + descripción larga (HTML de Steam). */
export function GameDetailSteamDetailsPanel({ details }: { details: SteamAppDetailsResult }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-default-200/70 bg-default-50/30 dark:border-default-100/20 dark:bg-default-50/10">
        <div className="border-b border-default-200/60 px-4 py-3 dark:border-default-100/15">
          <h3 className="text-sm font-semibold text-foreground">{t("library.detail.techSpecs")}</h3>
          <p className="mt-0.5 text-xs text-default-500">{t("library.detail.techSpecsSubtitle")}</p>
        </div>
        <dl className="divide-y divide-default-200/50 dark:divide-default-100/20">
          {details.developers.length > 0 && (
            <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-6">
              <dt className="shrink-0 sm:w-36">
                <FieldLabel icon={<Users size={14} className="opacity-80" />} label={t("library.detail.developers")} />
              </dt>
              <dd className="text-sm text-default-700 dark:text-default-300">{details.developers.join(", ")}</dd>
            </div>
          )}

          {details.publishers.length > 0 && (
            <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-6">
              <dt className="shrink-0 sm:w-36">
                <FieldLabel icon={<Users size={14} className="opacity-80" />} label={t("library.detail.publishers")} />
              </dt>
              <dd className="text-sm text-default-700 dark:text-default-300">{details.publishers.join(", ")}</dd>
            </div>
          )}

          {details.releaseDate && (
            <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-6">
              <dt className="shrink-0 sm:w-36">
                <FieldLabel
                  icon={<CalendarDays size={14} className="opacity-80" />}
                  label={t("library.detail.releaseDate")}
                />
              </dt>
              <dd className="text-sm text-default-700 dark:text-default-300">{details.releaseDate}</dd>
            </div>
          )}
        </dl>
      </div>

      {details.detailedDescription ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-1 border-b border-default-200/50 pb-4 dark:border-default-100/15">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">{t("library.detail.aboutGame")}</h3>
            <p className="text-xs text-default-500">{t("library.detail.storeTextSubtitle")}</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-default-200/60 bg-default-50/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:border-default-100/20 dark:bg-default-50/5">
            <ScrollShadow className="max-h-[min(70vh,42rem)]" size={72}>
              <div
                className={STEAM_EMBED_CLASSES}
                dangerouslySetInnerHTML={{ __html: stripScriptTags(details.detailedDescription) }}
              />
            </ScrollShadow>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function GameDetailRequirementsPanel({ details }: { details: SteamAppDetailsResult }) {
  const { t } = useTranslation();
  const hasStoreRequirements = !!(details.pcRequirementsMinimum || details.pcRequirementsRecommended);
  const compatibility = useRunCompatibility(
    details.pcRequirementsMinimum,
    details.pcRequirementsRecommended,
    hasStoreRequirements
  );

  if (!hasStoreRequirements) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-default-600 dark:text-default-400">{t("library.detail.noRequirements")}</p>
        <p className="text-xs leading-relaxed text-default-500">{t("library.detail.noRequirementsDesc")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GameDetailRunCompatibility
        report={compatibility.data}
        isLoading={compatibility.isLoading}
        isError={compatibility.isError}
      />
      <p className="text-xs text-default-500">{t("library.detail.requirementsStoreDisclaimer")}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {details.pcRequirementsMinimum && (
          <div className="overflow-hidden rounded-xl border border-default-200/70 bg-linear-to-b from-default-100/50 to-content1 dark:border-default-100/20 dark:from-default-100/15 dark:to-default-50/5">
            <div className="border-b border-default-200/60 px-4 py-2.5 dark:border-default-100/15">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-default-500">
                {t("library.detail.requirementsMin")}
              </p>
            </div>
            <div className="px-4 py-3">
              <div
                className="text-xs leading-relaxed text-default-600 [&_strong]:text-default-800 dark:text-default-400 dark:[&_strong]:text-default-200"
                dangerouslySetInnerHTML={{ __html: stripScriptTags(details.pcRequirementsMinimum) }}
              />
            </div>
          </div>
        )}
        {details.pcRequirementsRecommended && (
          <div className="overflow-hidden rounded-xl border border-primary-200/40 bg-linear-to-b from-primary-50/40 to-content1 dark:border-primary-500/20 dark:from-primary-500/10 dark:to-default-50/5">
            <div className="border-b border-primary-200/35 px-4 py-2.5 dark:border-primary-500/20">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary-700 dark:text-primary-400">
                {t("library.detail.requirementsRec")}
              </p>
            </div>
            <div className="px-4 py-3">
              <div
                className="text-xs leading-relaxed text-default-600 [&_strong]:text-default-800 dark:text-default-400 dark:[&_strong]:text-default-200"
                dangerouslySetInnerHTML={{ __html: stripScriptTags(details.pcRequirementsRecommended) }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function hasSteamRequirements(details: SteamAppDetailsResult): boolean {
  return !!(details.pcRequirementsMinimum || details.pcRequirementsRecommended);
}

/** Juegos sin ficha de Steam: rutas y metadatos locales. */
export function GameDetailLocalSummary({ game }: { game: ConfiguredGame }) {
  const { t } = useTranslation();
  const pathCount = game.paths?.length ?? 0;

  const handleOpenFolder = async (path: string) => {
    try {
      await openPath(path);
    } catch (err) {
      console.error("Could not open folder:", err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner explicativo elegante */}
      <div className="rounded-xl border border-default-200/60 bg-default-100/40 p-4 dark:border-default-100/15 dark:bg-default-50/5">
        <div className="flex items-center gap-2 mb-1 text-xs font-semibold uppercase tracking-wider text-default-500">
          <Gamepad2 size={15} className="text-primary" />
          <span>{t("library.detail.local.badge")}</span>
        </div>
        <p className="text-sm leading-relaxed text-default-600 dark:text-default-400">
          {t("library.detail.local.description")}
        </p>
      </div>

      {/* Rutas de guardado configuradas */}
      <div className="rounded-xl border border-default-200/70 bg-content1 shadow-xs dark:border-default-100/20">
        <div className="flex items-center justify-between border-b border-default-200/50 px-4 py-3 dark:border-default-100/15">
          <div className="flex items-center gap-2.5">
            <FolderOpen size={18} className="text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t("library.detail.local.savePathsTitle", { count: pathCount })}
              </p>
              <p className="text-xs text-default-500">{t("library.detail.local.savePathsSubtitle")}</p>
            </div>
          </div>
        </div>

        {game.paths && game.paths.length > 0 ? (
          <div className="divide-y divide-default-200/40 p-2 dark:divide-default-100/10">
            {game.paths.map((p, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-default-100/50 dark:hover:bg-white/5 transition-colors">
                <span className="text-xs font-mono text-default-700 dark:text-default-300 truncate max-w-[80%]">
                  {p}
                </span>
                <Button
                  size="sm"
                  variant="flat"
                  className="h-7 px-2 text-[11px]"
                  startContent={<FolderOpen size={13} />}
                  onPress={() => void handleOpenFolder(p)}>
                  {t("library.detail.local.openFolder")}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-3">
            <p className="text-xs text-default-500">{t("library.detail.local.noPathsConfigured")}</p>
          </div>
        )}
      </div>

      {/* Configuración de Ejecutable y Edición */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-default-200/70 bg-content1 p-4 dark:border-default-100/20">
          <p className="text-xs font-semibold text-default-400 uppercase tracking-wider mb-2">
            {t("library.detail.local.executionTitle")}
          </p>
          {game.launchExecutablePath?.trim() ? (
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-500 font-medium">
                <CheckCircle2 size={14} /> {t("library.detail.local.executableConfigured")}
              </span>
              <p className="text-xs font-mono text-default-500 truncate">{game.launchExecutablePath}</p>
            </div>
          ) : (
            <p className="text-xs text-default-500">{t("library.detail.local.noExecutableConfigured")}</p>
          )}
        </div>

        <div className="rounded-xl border border-default-200/70 bg-content1 p-4 dark:border-default-100/20">
          <p className="text-xs font-semibold text-default-400 uppercase tracking-wider mb-2">
            {t("library.detail.local.editionTitle")}
          </p>
          <p className="text-xs text-default-700 dark:text-default-300 font-medium">
            {game.editionLabel?.trim() || t("library.detail.local.standardEdition")}
          </p>
          {game.sourceUrl ? <p className="text-xs text-primary truncate mt-1">{game.sourceUrl}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function GameDetailInfoLoading() {
  return (
    <div className="space-y-4 pt-2">
      <Skeleton className="h-5 w-48 rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-5 w-32 rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}

/** @deprecated Usar paneles con pestañas en GameDetailPage; se mantiene por compatibilidad. */
export function GameDetailInfo({ details, isLoading }: GameDetailInfoProps) {
  if (isLoading) {
    return <GameDetailInfoLoading />;
  }

  if (!details) return null;

  return (
    <div className="space-y-6">
      <GameDetailSummaryPanel details={details} />
      <Divider />
      <GameDetailSteamDetailsPanel details={details} />
      {hasSteamRequirements(details) && (
        <>
          <Divider />
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-default-700 dark:text-default-300">Requisitos del sistema</h3>
            <GameDetailRequirementsPanel details={details} />
          </div>
        </>
      )}
    </div>
  );
}
