import { useCallback, useState } from "react";
import { Button, Chip, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Spinner } from "@heroui/react";
import { Copy, ExternalLink, Film, Play, Plus, RotateCw, Trash2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { deleteGameClip, listGameClips, uploadGameClip, type ClipItem } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import { toastError, toastSuccess } from "@utils/toast";
import type { ConfiguredGame } from "@app-types/config";

export interface GameClipsModalProps {
  isOpen: boolean;
  onClose: () => void;
  game: ConfiguredGame | null;
}

export function GameClipsModal({ isOpen, onClose, game }: GameClipsModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  const [activePreviewClipId, setActivePreviewClipId] = useState<string | null>(null);

  const gameId = game?.id ?? "";

  const {
    data: clips = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["game-clips", gameId],
    queryFn: () => listGameClips(gameId),
    enabled: isOpen && Boolean(gameId),
    staleTime: 1000 * 30,
  });

  const handleUpload = useCallback(async () => {
    if (!gameId) return;

    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: t("library.detail.pickClipTitle"),
        filters: [
          {
            name: t("library.detail.videoFilterName"),
            extensions: ["mp4", "webm", "mov", "mkv"],
          },
        ],
      });

      if (!selected || typeof selected !== "string") {
        return;
      }

      setIsUploading(true);
      toastSuccess(t("library.toast.uploadingClipTitle"), t("library.toast.uploadingClipDesc"));

      const result = await uploadGameClip(gameId, selected);
      await navigator.clipboard.writeText(result.watchUrl);
      toastSuccess(t("library.toast.clipUploadedTitle"), t("library.toast.clipUploadedDesc"));

      await queryClient.invalidateQueries({ queryKey: ["game-clips", gameId] });
    } catch (e) {
      toastError(
        t("library.toast.clipUploadError"),
        e instanceof Error ? e.message : t("library.toast.unexpectedError")
      );
    } finally {
      setIsUploading(false);
    }
  }, [gameId, queryClient, t]);

  const handleCopyLink = useCallback(
    async (watchUrl: string) => {
      try {
        await navigator.clipboard.writeText(watchUrl);
        toastSuccess(t("library.toast.shareLinkCopied"), t("library.toast.shareLinkCopiedDesc"));
      } catch (e) {
        toastError(t("library.toast.cannotShare"), e instanceof Error ? e.message : t("library.toast.unexpectedError"));
      }
    },
    [t]
  );

  const handleOpenBrowser = useCallback((watchUrl: string) => {
    openUrl(watchUrl).catch((err) => {
      console.error("Failed to open clip URL", err);
    });
  }, []);

  const handleDelete = useCallback(
    async (clip: ClipItem) => {
      const confirmed = await ask(t("library.clipsModal.deleteConfirmMsg", { filename: clip.filename }), {
        title: t("library.clipsModal.deleteConfirmTitle"),
        kind: "warning",
      });

      if (!confirmed) return;

      try {
        await deleteGameClip(clip.clipId);
        toastSuccess(t("library.clipsModal.deletedTitle"), t("library.clipsModal.deletedDesc"));
        await queryClient.invalidateQueries({ queryKey: ["game-clips", gameId] });
      } catch (e) {
        toastError(
          t("library.clipsModal.deleteError"),
          e instanceof Error ? e.message : t("library.toast.unexpectedError")
        );
      }
    },
    [gameId, queryClient, t]
  );

  if (!game) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="3xl"
      scrollBehavior="inside"
      classNames={{
        base: "bg-content1 border border-default-200/80 shadow-2xl backdrop-blur-xl text-foreground",
        header: "border-b border-default-200/60 pb-3 pr-12",
        footer: "border-t border-default-200/60 pt-3",
        closeButton:
          "top-3.5 right-3.5 z-50 text-default-400 hover:text-foreground hover:bg-default-100 active:scale-95",
      }}>
      <ModalContent>
        <ModalHeader className="flex items-center justify-between gap-4 mr-2">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="size-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Film size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold text-foreground leading-tight truncate">
                {t("library.clipsModal.title", { gameName: formatGameDisplayName(game.id) })}
              </h2>
              <p className="text-xs text-default-500 font-normal mt-0.5 truncate">{t("library.clipsModal.subtitle")}</p>
            </div>
          </div>

          <Button
            size="sm"
            color="primary"
            variant="solid"
            startContent={<Plus size={16} />}
            isLoading={isUploading}
            isDisabled={isUploading}
            onPress={handleUpload}
            className="font-semibold shadow-md shadow-primary/20 shrink-0 mr-4">
            {t("library.uploadClip")}
          </Button>
        </ModalHeader>

        <ModalBody className="py-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-default-400">
              <Spinner size="md" color="primary" />
              <p className="text-sm">{t("library.clipsModal.loading")}</p>
            </div>
          ) : clips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="size-16 rounded-2xl bg-default-100 border border-default-200 flex items-center justify-center text-default-400 mb-3 shadow-inner">
                <Video size={28} />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1">{t("library.clipsModal.emptyTitle")}</h3>
              <p className="text-xs text-default-500 max-w-sm mb-4">{t("library.clipsModal.emptyDesc")}</p>
              <Button
                size="sm"
                variant="flat"
                color="primary"
                startContent={<Plus size={16} />}
                isLoading={isUploading}
                isDisabled={isUploading}
                onPress={handleUpload}>
                {t("library.uploadClip")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {clips.map((clip: ClipItem) => {
                const formattedDate = new Date(clip.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const isPlayingPreview = activePreviewClipId === clip.clipId;

                return (
                  <div
                    key={clip.clipId}
                    className="p-3.5 rounded-xl bg-default-50 hover:bg-default-100/70 border border-default-200/80 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group">
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      {/* Video Thumbnail / Live Preview */}
                      {isPlayingPreview ? (
                        <div className="w-44 sm:w-52 aspect-video rounded-lg overflow-hidden bg-black border border-primary/50 shadow-lg relative shrink-0">
                          <video
                            src={clip.cdnUrl}
                            controls
                            autoPlay
                            playsInline
                            className="w-full h-full object-contain"
                          />
                        </div>
                      ) : (
                        <div
                          onClick={() => setActivePreviewClipId(clip.clipId)}
                          className="w-40 sm:w-48 aspect-video rounded-lg bg-black border border-default-200 hover:border-primary/50 flex items-center justify-center relative overflow-hidden shrink-0 cursor-pointer group shadow-sm">
                          {/* Image snapshot or video decoded frame */}
                          {clip.posterUrl ? (
                            <img
                              src={clip.posterUrl}
                              alt={clip.filename}
                              loading="lazy"
                              className="w-full h-full object-cover rounded-lg group-hover:scale-105 transition-transform duration-300 pointer-events-none"
                            />
                          ) : (
                            <video
                              src={`${clip.cdnUrl}#t=0.1`}
                              preload="metadata"
                              muted
                              playsInline
                              className="w-full h-full object-cover rounded-lg group-hover:scale-105 transition-transform duration-300 pointer-events-none"
                            />
                          )}
                          <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <div className="size-9 rounded-full bg-black/75 border border-white/20 group-hover:bg-primary group-hover:border-primary group-hover:scale-110 flex items-center justify-center text-white transition-all shadow-lg backdrop-blur-sm">
                              <Play size={15} className="ml-0.5 fill-current" />
                            </div>
                          </div>
                          <span className="absolute bottom-1.5 right-1.5 text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded bg-black/80 text-white/90 backdrop-blur-sm border border-white/10">
                            {clip.contentType.replace("video/", "").toUpperCase()}
                          </span>
                        </div>
                      )}

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground truncate" title={clip.filename}>
                            {clip.filename}
                          </p>
                          <Chip
                            size="sm"
                            variant="flat"
                            className="text-[10px] h-5 bg-default-100 text-default-600 border border-default-200/50 font-medium">
                            {clip.contentType.replace("video/", "").toUpperCase()}
                          </Chip>
                        </div>
                        <p className="text-xs text-default-500">{formattedDate}</p>
                        <p className="text-[11px] font-mono text-default-400 truncate select-all">{clip.watchUrl}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                      <Button
                        size="sm"
                        variant="flat"
                        isIconOnly
                        title={t("library.clipsModal.copyLink")}
                        onPress={() => handleCopyLink(clip.watchUrl)}
                        className="bg-default-100 hover:bg-default-200 text-default-700">
                        <Copy size={15} />
                      </Button>

                      <Button
                        size="sm"
                        variant="flat"
                        isIconOnly
                        title={t("library.clipsModal.openBrowser")}
                        onPress={() => handleOpenBrowser(clip.watchUrl)}
                        className="bg-default-100 hover:bg-default-200 text-default-700">
                        <ExternalLink size={15} />
                      </Button>

                      <Button
                        size="sm"
                        variant="flat"
                        color="danger"
                        isIconOnly
                        title={t("library.clipsModal.deleteClip")}
                        onPress={() => handleDelete(clip)}
                        className="bg-danger/10 hover:bg-danger/20 text-danger">
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ModalBody>

        <ModalFooter className="flex items-center justify-between">
          <Button
            size="sm"
            variant="light"
            startContent={<RotateCw size={14} className={isRefetching ? "hidden" : ""} />}
            onPress={() => void refetch()}
            isLoading={isRefetching}
            className="text-default-500 hover:text-foreground">
            {t("library.clipsModal.refresh", t("common.refresh", "Actualizar"))}
          </Button>

          <Button size="sm" variant="flat" onPress={onClose}>
            {t("common.close", "Cerrar")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
