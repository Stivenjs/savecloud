import { Modal, ModalBody, ModalContent, ModalHeader, Spinner } from "@heroui/react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import {
  fetchGitHubReleaseNotes,
  linkifyReleaseMarkdown,
  getReleaseNotesFallbackMarkdown,
} from "@services/github/release-notes.service";

interface ReleaseNotesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ReleaseNotesDialog({ isOpen, onClose }: ReleaseNotesDialogProps) {
  const { t, i18n } = useTranslation();

  const releaseNotesQuery = useQuery({
    queryKey: ["github-release-notes"],
    queryFn: ({ signal }) => fetchGitHubReleaseNotes(10, signal),
    enabled: isOpen,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const releases = releaseNotesQuery.data ?? [];
  const loading = releaseNotesQuery.isLoading;
  const error = releaseNotesQuery.error instanceof Error ? releaseNotesQuery.error.message : null;

  const fallbackMarkdown = useMemo(() => getReleaseNotesFallbackMarkdown(), []);
  const dateLocale = i18n.language === "es" ? "es-ES" : "en-US";

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      placement="center"
      size="2xl"
      scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 text-left">{t("releaseNotes.title")}</ModalHeader>

        <ModalBody className="max-h-[70vh] overflow-y-auto pb-6">
          {loading ? (
            <div className="flex min-h-72 items-center justify-center">
              <div className="flex items-center gap-3 text-sm text-default-500">
                <Spinner size="sm" />
                <span>{t("releaseNotes.loading")}</span>
              </div>
            </div>
          ) : error ? (
            <div className="space-y-4">
              <div className="rounded-large border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
                {t("releaseNotes.errorFallback")}
              </div>
              <div className="prose prose-sm max-w-full overflow-auto rounded-large border border-default-200 p-4 text-default-600 prose-pre:rounded-md prose-pre:bg-default-100 prose-pre:p-2">
                <ReactMarkdown>{linkifyReleaseMarkdown(fallbackMarkdown)}</ReactMarkdown>
              </div>
            </div>
          ) : releases.length > 0 ? (
            <div className="space-y-6">
              <div className="rounded-large border border-default-200 bg-default-50 px-4 py-3 text-sm text-default-500">
                {t("releaseNotes.subtitle")}
              </div>
              {releases.map((release) => (
                <section key={release.id} className="space-y-3 rounded-large border border-default-200 p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">{release.name}</h3>
                      <p className="text-xs uppercase tracking-wide text-default-500">{release.tagName}</p>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-default-500">
                      <span>
                        {release.publishedAt
                          ? new Date(release.publishedAt).toLocaleDateString(dateLocale, { dateStyle: "medium" })
                          : t("releaseNotes.noDate")}
                      </span>
                      <a
                        className="text-primary underline-offset-4 hover:underline"
                        href={release.htmlUrl}
                        rel="noreferrer"
                        target="_blank">
                        {t("releaseNotes.openInGithub")}
                      </a>
                    </div>
                  </div>
                  <div className="prose prose-sm max-w-full overflow-auto text-default-600 prose-pre:rounded-md prose-pre:bg-default-100 prose-pre:p-2">
                    <ReactMarkdown>{linkifyReleaseMarkdown(release.body)}</ReactMarkdown>
                  </div>
                  <div className="text-xs text-default-400">
                    {release.prerelease ? t("releaseNotes.prerelease") : t("releaseNotes.stable")}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-large border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
                {t("releaseNotes.emptyFallback")}
              </div>
              <div className="prose prose-sm max-w-full overflow-auto rounded-large border border-default-200 p-4 text-default-600 prose-pre:rounded-md prose-pre:bg-default-100 prose-pre:p-2">
                <ReactMarkdown>{linkifyReleaseMarkdown(fallbackMarkdown)}</ReactMarkdown>
              </div>
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
