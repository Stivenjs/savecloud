import { useEffect, useRef } from "react";
import Hls from "hls.js";
import { Button, Modal, ModalContent } from "@heroui/react";
import { X } from "lucide-react";

const isHlsUrl = (url: string) => url.includes(".m3u8");

export interface GameVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** URL del vídeo (HLS .m3u8 o directa). */
  videoUrl: string;
}

export function GameVideoModal({
  isOpen,
  onClose,
  videoUrl,
}: GameVideoModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

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
    if (Hls.isSupported()) {
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(videoUrl);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoEl.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) hls.destroy();
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      videoEl.src = videoUrl;
      videoEl.play().catch(() => {});
    }
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
      }}
    >
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
            preload="auto"
          />
          <div className="absolute right-2 top-2 z-10">
            <Button
              isIconOnly
              size="sm"
              variant="flat"
              className="min-w-9 w-9 h-9 rounded-lg bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
              aria-label="Cerrar"
              onPress={onClose}
            >
              <X size={18} strokeWidth={2} />
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
