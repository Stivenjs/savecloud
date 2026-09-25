import { useEffect, useRef, useState, useCallback } from "react";
import { initHls, isHlsUrl } from "@utils/hls";
import type { HlsType } from "@utils/hls";
import { Button, Modal, ModalContent } from "@heroui/react";
import { X } from "lucide-react";
import { useAppVisibility } from "@hooks/useAppVisibility";
import { VideoQualitySelector } from "@/components/video/VideoQualitySelector";

export interface GameVideoModalProps {
  /** URL del vídeo (HLS .m3u8 o directa). */
  videoUrl: string;
  isOpen: boolean;
  onClose: () => void;
}

export function GameVideoModal({ isOpen, onClose, videoUrl }: GameVideoModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const { isVisible } = useAppVisibility();
  const wasPlayingRef = useRef(false);
  const [qualities, setQualities] = useState<{ index: number; label: string }[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1);

  const useHls = isOpen && videoUrl != null && isHlsUrl(videoUrl);

  useEffect(() => {
    if (!isOpen) {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      videoRef.current?.pause();
      wasPlayingRef.current = false;
      setQualities([]);
      setCurrentQuality(-1);
      return;
    }
  }, [isOpen]);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !isOpen) return;

    if (!isVisible) {
      wasPlayingRef.current = !videoEl.paused;
      if (wasPlayingRef.current) {
        videoEl.pause();
      }
    } else {
      if (wasPlayingRef.current) {
        videoEl.play().catch(() => {});
      }
    }
  }, [isVisible, isOpen]);

  useEffect(() => {
    if (!isOpen || !videoUrl || !useHls) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    let isMounted = true;

    const initVideo = async () => {
      const hlsInstance = await initHls({
        videoEl,
        videoUrl,
        onManifestParsed: () => {
          if (isMounted) {
            videoEl.play().catch(() => {});
            if (hlsInstance) {
              const levels = hlsInstance.levels;
              const list = levels.map((lvl, idx) => ({
                index: idx,
                label: lvl.height ? `${lvl.height}p` : `Calidad ${idx + 1}`,
              }));
              setQualities(list);
              setCurrentQuality(hlsInstance.currentLevel);
            }
          }
        },
        onError: (data) => {
          if (data.fatal && isMounted) {
            hlsRef.current = null;
          }
        },
      });

      if (!isMounted) {
        hlsInstance?.destroy();
        return;
      }

      if (hlsInstance) {
        hlsRef.current = hlsInstance;
      } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
        videoEl.src = videoUrl;
        videoEl.play().catch(() => {});
      }
    };

    initVideo();

    return () => {
      isMounted = false;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [isOpen, videoUrl, useHls]);

  useEffect(() => {
    if (isOpen && !useHls && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [isOpen, useHls]);

  const selectQuality = useCallback((idx: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = idx;
      setCurrentQuality(idx);
    }
  }, []);

  const handleVideoClick = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const rect = videoEl.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    if (clickY < rect.height - 60) {
      e.preventDefault();
      if (videoEl.paused) {
        videoEl.play().catch(() => {});
      } else {
        videoEl.pause();
      }
    }
  }, []);

  if (!videoUrl?.trim()) return null;

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      placement="center"
      size="5xl"
      classNames={{
        base: "max-w-[95vw] w-full",
        wrapper: "items-center",
      }}>
      <ModalContent className="bg-black/95 p-0 overflow-hidden">
        <div className="relative flex items-center justify-center bg-black min-h-[60vh] aspect-video max-h-[92vh] w-full">
          <video
            ref={videoRef}
            src={useHls ? undefined : videoUrl}
            className="max-h-[92vh] w-full object-contain cursor-pointer"
            muted
            loop
            playsInline
            controls
            controlsList="nofullscreen"
            preload="auto"
            onClick={handleVideoClick}
          />
          <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
            {qualities.length > 0 && (
              <VideoQualitySelector
                qualities={qualities}
                currentQuality={currentQuality}
                onSelectQuality={selectQuality}
                placement="bottom-end"
                buttonSize="md"
              />
            )}
            <Button
              isIconOnly
              size="sm"
              variant="flat"
              className="min-w-9 w-9 h-9 rounded-lg bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
              aria-label="Cerrar"
              onPress={onClose}>
              <X size={18} strokeWidth={2} />
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
