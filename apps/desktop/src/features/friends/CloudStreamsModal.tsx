import { Button, Modal, ModalBody, ModalContent, ModalHeader, Spinner } from "@heroui/react";
import { Eye, Radio, RadioTower, Square, Video, X } from "lucide-react";
import { useCloudStreamsModal } from "@hooks/useCloudStreamsModal";
import { StreamQualityControls } from "@features/friends/StreamQualityControls";

interface CloudStreamsModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalRef: React.RefObject<HTMLElement>;
}

export function CloudStreamsModal({ isOpen, onClose, modalRef }: CloudStreamsModalProps) {
  const {
    error,
    handleJoinStream,
    handleModalOpenChange,
    handleStartStream,
    handleStopStream,
    isLoading,
    localUserId,
    moveProps,
    myStream,
    previewEnabled,
    previewVideoRef,
    selectedFps,
    selectedResolution,
    setPreviewEnabled,
    setSelectedFps,
    setSelectedResolution,
    sortedStreams,
  } = useCloudStreamsModal({ isOpen, onClose, modalRef });

  return (
    <Modal
      ref={modalRef}
      isOpen={isOpen}
      onOpenChange={handleModalOpenChange}
      isDismissable
      isKeyboardDismissDisabled={false}
      hideCloseButton
      backdrop="transparent"
      placement="center"
      classNames={{
        wrapper: "z-[9999]",
        base: "flex h-[min(82dvh,760px)] w-[min(90vw,460px)] flex-col overflow-hidden rounded-[18px] border border-default-200/80 bg-background/65 shadow-2xl backdrop-blur-md",
      }}>
      <ModalContent>
        {() => (
          <div className="relative h-full">
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="default"
              className="absolute right-2 top-2 z-20"
              aria-label="Cerrar modal de transmisiones"
              onPress={onClose}>
              <X className="h-4 w-4" />
            </Button>

            <ModalHeader
              {...moveProps}
              className="flex items-center justify-between gap-2 border-b border-default-200/70 pr-12">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-danger" />
                <span className="text-sm font-semibold">Transmisiones activas</span>
              </div>
              <div className="flex items-center gap-2">
                {myStream ? (
                  <>
                    <Button
                      size="sm"
                      variant="flat"
                      color="default"
                      startContent={<Eye className="h-4 w-4" />}
                      isDisabled={isLoading}
                      onPress={() => setPreviewEnabled((prev) => !prev)}>
                      {previewEnabled ? "Ocultar preview" : "Previsualizar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      color="danger"
                      startContent={<Square className="h-4 w-4" />}
                      isDisabled={isLoading}
                      onPress={() => handleStopStream(myStream.streamId)}>
                      Detener
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="solid"
                    color="primary"
                    startContent={<RadioTower className="h-4 w-4" />}
                    isDisabled={isLoading}
                    onPress={handleStartStream}>
                    Iniciar transmisión
                  </Button>
                )}
              </div>
            </ModalHeader>

            <ModalBody className="h-full overflow-y-auto px-3 py-3">
              {!myStream ? (
                <StreamQualityControls
                  resolution={selectedResolution}
                  fps={selectedFps}
                  onResolutionChange={setSelectedResolution}
                  onFpsChange={setSelectedFps}
                  disabled={isLoading}
                />
              ) : null}

              {error ? (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </div>
              ) : null}

              {isLoading ? (
                <div className="flex items-center gap-2 text-default-500">
                  <Spinner size="sm" color="primary" />
                  <span className="text-sm">Procesando...</span>
                </div>
              ) : null}

              {previewEnabled && myStream ? (
                <div className="space-y-2 rounded-lg border border-default-200/70 bg-background/70 p-2">
                  <p className="text-[11px] font-medium text-default-600">Previsualizacion local (host)</p>
                  <div className="overflow-hidden rounded-md border border-default-200/60 bg-black/80">
                    <video
                      ref={previewVideoRef}
                      className="h-52 w-full object-contain"
                      autoPlay
                      playsInline
                      controls
                      muted
                    />
                  </div>
                </div>
              ) : null}

              {!sortedStreams.length ? (
                <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-default-200/70 bg-default-50/30 px-4 py-6 text-center text-default-500">
                  <Video className="h-5 w-5" />
                  <p className="text-sm">No hay transmisiones activas en tu cloud.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedStreams.map((stream) => {
                    const isMine = stream.hostUserId === localUserId;
                    return (
                      <div
                        key={stream.streamId}
                        className="rounded-lg border border-default-200/80 bg-default-50/35 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{stream.hostUserId}</p>
                            <p className="truncate text-[11px] text-default-500">
                              {stream.qualityPreset} · {stream.hasSystemAudio ? "audio sistema" : "sin audio"}
                              {stream.hasMicAudio ? " + mic" : ""} · {stream.viewerCount}/{stream.maxViewers} viewers
                            </p>
                          </div>

                          {isMine ? (
                            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              Tu transmisión
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="flat"
                              color="primary"
                              isDisabled={stream.viewerCount >= stream.maxViewers}
                              onPress={() => handleJoinStream(stream.streamId, stream.hostUserId)}>
                              {stream.viewerCount >= stream.maxViewers ? "Lleno" : "Ver"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ModalBody>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
