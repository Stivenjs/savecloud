import type { ReactNode } from "react";
import { Divider, ScrollShadow, Skeleton } from "@heroui/react";
import { CalendarDays, Code2, FolderOpen, Tags, Users } from "lucide-react";
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

interface GameDetailInfoProps {
  details: SteamAppDetailsResult | null;
  isLoading: boolean;
}

/** Contenido de la pestaña Resumen: descripción corta, géneros y categorías. */
export function GameDetailSummaryPanel({ details }: { details: SteamAppDetailsResult }) {
  const genreCount = details.genres.length;
  const categoryCount = details.categories.length;
  const blurb = resolveSteamSummaryBlurb(details);

  const metaBits: string[] = [];
  if (details.releaseDate) metaBits.push(details.releaseDate);
  if (genreCount > 0) metaBits.push(`${genreCount} género${genreCount === 1 ? "" : "s"}`);
  if (categoryCount > 0) metaBits.push(`${categoryCount} categoría${categoryCount === 1 ? "" : "s"}`);

  return (
    <div className="space-y-8">
      {metaBits.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-default-600 dark:text-default-400">
          {details.releaseDate ? <CalendarDays size={14} className="shrink-0 opacity-70" aria-hidden /> : null}
          <span>{metaBits.join(" · ")}</span>
        </p>
      ) : null}

      {blurb ? (
        <div>
          <div className="mb-3 flex flex-col gap-0.5">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">Sinopsis</h3>
            {blurb.subtitle ? <p className="text-xs text-default-500">{blurb.subtitle}</p> : null}
          </div>
          <div className="border-l-2 border-primary/35 pl-5">
            <p className="whitespace-pre-line text-[15px] leading-[1.65] text-default-700 dark:text-default-300">
              {blurb.text}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-default-300/70 bg-default-100/20 px-4 py-3.5 dark:border-default-100/25 dark:bg-default-50/10">
          <p className="text-sm leading-relaxed text-default-600 dark:text-default-400">
            No hay texto breve en la ficha de Steam. La descripción completa está en la pestaña{" "}
            <span className="font-medium text-foreground">Detalles</span>.
          </p>
        </div>
      )}

      {(details.genres.length > 0 || details.categories.length > 0) && (
        <div className="space-y-5 border-t border-default-200/60 pt-8 dark:border-default-100/15">
          {details.genres.length > 0 && (
            <div className="space-y-2.5">
              <FieldLabel icon={<Tags size={14} className="opacity-80" />} label="Géneros" />
              <div className="flex flex-wrap gap-2">
                {details.genres.map((genre, idx) => (
                  <span
                    key={`${genre}-${idx}`}
                    className="rounded-lg bg-default-100/90 px-2.5 py-1 text-xs font-medium text-default-700 ring-1 ring-default-200/80 dark:bg-default-100/20 dark:text-default-300 dark:ring-default-100/20">
                    {genre}
                  </span>
                ))}
              </div>
            </div>
          )}

          {details.categories.length > 0 && (
            <div className="space-y-2.5">
              <FieldLabel icon={<Code2 size={14} className="opacity-80" />} label="Categorías" />
              <div className="flex flex-wrap gap-2">
                {details.categories.map((cat, idx) => (
                  <span
                    key={`${cat}-${idx}`}
                    className="rounded-lg bg-default-50/90 px-2.5 py-1 text-xs text-default-600 ring-1 ring-default-200/60 dark:bg-default-50/10 dark:text-default-400 dark:ring-default-100/15">
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Ficha técnica + descripción larga (HTML de Steam). */
export function GameDetailSteamDetailsPanel({ details }: { details: SteamAppDetailsResult }) {
  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-default-200/70 bg-default-50/30 dark:border-default-100/20 dark:bg-default-50/10">
        <div className="border-b border-default-200/60 px-4 py-3 dark:border-default-100/15">
          <h3 className="text-sm font-semibold text-foreground">Ficha técnica</h3>
          <p className="mt-0.5 text-xs text-default-500">Desarrollo, publicación y fecha</p>
        </div>
        <dl className="divide-y divide-default-200/50 dark:divide-default-100/20">
          {details.developers.length > 0 && (
            <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-6">
              <dt className="shrink-0 sm:w-36">
                <FieldLabel icon={<Users size={14} className="opacity-80" />} label="Desarrollador" />
              </dt>
              <dd className="text-sm text-default-700 dark:text-default-300">{details.developers.join(", ")}</dd>
            </div>
          )}

          {details.publishers.length > 0 && (
            <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-6">
              <dt className="shrink-0 sm:w-36">
                <FieldLabel icon={<Users size={14} className="opacity-80" />} label="Editor" />
              </dt>
              <dd className="text-sm text-default-700 dark:text-default-300">{details.publishers.join(", ")}</dd>
            </div>
          )}

          {details.releaseDate && (
            <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-6">
              <dt className="shrink-0 sm:w-36">
                <FieldLabel icon={<CalendarDays size={14} className="opacity-80" />} label="Lanzamiento" />
              </dt>
              <dd className="text-sm text-default-700 dark:text-default-300">{details.releaseDate}</dd>
            </div>
          )}
        </dl>
      </div>

      {details.detailedDescription ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-1 border-b border-default-200/50 pb-4 dark:border-default-100/15">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">Información sobre el juego</h3>
            <p className="text-xs text-default-500">Texto de la tienda (puede incluir imágenes)</p>
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
  const hasStoreRequirements = !!(details.pcRequirementsMinimum || details.pcRequirementsRecommended);
  const compatibility = useRunCompatibility(
    details.pcRequirementsMinimum,
    details.pcRequirementsRecommended,
    hasStoreRequirements
  );

  if (!hasStoreRequirements) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-default-600 dark:text-default-400">
          No hay requisitos publicados en la tienda para este título.
        </p>
        <p className="text-xs leading-relaxed text-default-500">
          Sin requisitos en la ficha de Steam no podemos estimar si tu PC los cumple; consulta la web del desarrollador
          o la tienda donde compraste el juego.
        </p>
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
      <p className="text-xs text-default-500">
        Especificaciones de la tienda; pueden no coincidir con el hardware desde el que uses SaveCloud.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {details.pcRequirementsMinimum && (
          <div className="overflow-hidden rounded-xl border border-default-200/70 bg-linear-to-b from-default-100/50 to-content1 dark:border-default-100/20 dark:from-default-100/15 dark:to-default-50/5">
            <div className="border-b border-default-200/60 px-4 py-2.5 dark:border-default-100/15">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-default-500">Mínimos</p>
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
                Recomendados
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
  const pathCount = game.paths?.length ?? 0;

  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-default-600 dark:text-default-400">
        No hay datos de la tienda de Steam para este juego (sin App ID o ficha no disponible). Puedes seguir gestionando
        guardados y backups con las acciones de arriba.
      </p>
      <div className="rounded-xl border border-default-200/70 bg-default-50/40 px-4 py-3 shadow-sm dark:border-default-100/20 dark:bg-default-50/10">
        <p className="text-xs font-medium text-default-700 dark:text-default-300">Compatibilidad con tu PC</p>
        <p className="mt-2 text-xs leading-relaxed text-default-500">
          La comparación automática con tu equipo solo aparece cuando la app puede cargar la ficha de Steam. Para
          títulos fuera de Steam, revisa la web del juego o la tienda donde lo compraste.
        </p>
      </div>
      <div className="rounded-xl border border-default-200/70 bg-content1 dark:border-default-100/20">
        <div className="flex items-start gap-3 border-b border-default-200/50 px-4 py-3 dark:border-default-100/15">
          <FolderOpen size={18} className="mt-0.5 shrink-0 text-default-400" />
          <div>
            <p className="text-sm font-semibold text-foreground">Rutas de guardado</p>
            <p className="mt-1 text-sm text-default-500">
              {pathCount === 0
                ? "Ninguna ruta configurada."
                : `${pathCount} ruta${pathCount === 1 ? "" : "s"} registrada${pathCount === 1 ? "" : "s"}.`}
            </p>
          </div>
        </div>
        {game.editionLabel ? (
          <div className="px-4 py-3">
            <p className="text-xs text-default-500">
              <span className="font-medium text-default-700 dark:text-default-300">Origen / edición</span> —{" "}
              {game.editionLabel}
            </p>
          </div>
        ) : null}
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
