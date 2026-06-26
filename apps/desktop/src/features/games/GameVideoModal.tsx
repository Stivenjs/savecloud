import { useEffect, useRef } from "react";
import { initHls, isHlsUrl } from "@utils/hls";
import type { HlsType } from "@utils/hls";
import { Button, Modal, ModalContent } from "@heroui/react";
import { X } from "lucide-react";

export interface GameVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** URL del vídeo (HLS .m3u8 o directa). */
  videoUrl: string;
}

export function GameVideoModal({ isOpen, onClose, videoUrl }: GameVideoModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsType | null>(null);

  const useHls = isOpen && videoUrl != null && isHlsUrl(videoUrl);

  useEffect(() => {
    if (!isOpen) {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      videoRef.current?.pause();
      return;
    }
  }, [isOpen]);

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
            className="max-h-[92vh] w-full object-contain"
            muted
            loop
            playsInline
            controls
            controlsList="nofullscreen"
            preload="auto"
          />
          <div className="absolute right-2 top-2 z-10">
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
