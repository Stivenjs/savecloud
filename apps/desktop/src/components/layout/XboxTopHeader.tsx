import { memo, useEffect, useState } from "react";
import { ArrowLeft, Search, Tv } from "lucide-react";
import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useTauriWindow, WindowsControls, MacControls } from "@components/layout/TitleBar";

export interface XboxTopHeaderProps {
  onOpenSearch: () => void;
  onOpenBigPicture?: () => void;
  canGoBack?: boolean;
  onGoBack?: () => void;
  isCinematic?: boolean;
  className?: string;
}

export const XboxTopHeader = memo(function XboxTopHeader({
  onOpenSearch,
  onOpenBigPicture,
  canGoBack = false,
  onGoBack,
  isCinematic = false,
  className,
}: XboxTopHeaderProps) {
  const { t } = useTranslation();
  const { isMaximized, platform, minimize, maximize, close } = useTauriWindow();
  const isMac = platform === "macos";

  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    if (!isCinematic) {
      setIsScrolled(false);
      return;
    }
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 160);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isCinematic]);

  const showTransparent = isCinematic && !isScrolled;

  const labels = {
    close: t("common.close", "Cerrar"),
    minimize: t("common.minimize", "Minimizar"),
    maximize: t("common.maximize", "Maximizar"),
    restore: t("common.restore", "Restaurar"),
  };

  return (
    <header
      data-tauri-drag-region
      style={{ viewTransitionName: "none" }}
      className={`fixed top-0 left-17 right-0 h-13 z-30 flex items-center justify-between px-3 select-none transform-gpu ${
        className ?? ""
      }`}>
      <div
        className={`absolute inset-0 border-b border-default-200/30 dark:border-default-100/10 bg-background/80 dark:bg-background/85 backdrop-blur-xl transition-opacity duration-200 pointer-events-none ${
          showTransparent ? "opacity-0" : "opacity-100"
        }`}
      />

      {/* Zona izquierda: Botón Volver (Atrás) + Controles Mac + Arrastre */}
      <div data-tauri-drag-region className="relative z-10 flex items-center gap-2.5 min-w-30 h-full">
        {isMac ? (
          <div className="flex items-center gap-1.5 pl-1">
            <MacControls close={close} minimize={minimize} maximize={maximize} labels={labels} />
          </div>
        ) : null}

        {canGoBack && onGoBack ? (
          <button
            type="button"
            onClick={onGoBack}
            title={t("common.back", "Volver (Atrás)")}
            aria-label={t("common.back", "Volver")}
            className={`size-8 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 active:scale-90 ${
              showTransparent
                ? "bg-black/60 hover:bg-black/80 border border-white/20 text-white shadow-md"
                : "bg-default-100/80 hover:bg-default-200/80 dark:bg-default-50/20 dark:hover:bg-default-100/30 border border-default-200/60 dark:border-default-100/15 text-foreground shadow-xs"
            }`}>
            <ArrowLeft size={16} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>

      {/* Centro: Buscador global estilo Xbox (Ctrl + K) - Oculto en modo cinemático hasta hacer scroll */}
      <div
        data-tauri-drag-region
        className="relative z-10 flex items-center justify-center flex-1 max-w-xl px-2 h-full">
        <div
          className={`w-full max-w-md transition-all duration-300 ${
            showTransparent ? "opacity-0 pointer-events-none scale-95" : "opacity-100 scale-100"
          }`}>
          <button
            type="button"
            onClick={onOpenSearch}
            className="group relative flex items-center justify-between w-full h-8.5 px-3.5 rounded-full bg-default-100/80 hover:bg-default-200/60 dark:bg-default-50/15 dark:hover:bg-default-100/25 border border-default-200/60 dark:border-default-100/15 transition-all duration-200 text-default-400 hover:text-foreground shadow-xs cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={t("common.searchGames", "Buscar juegos, complementos y mucho más")}>
            <div className="flex items-center gap-2.5 min-w-0 pointer-events-none">
              <Search size={14} className="text-default-400 group-hover:text-primary transition-colors shrink-0" />
              <span className="text-xs truncate font-medium text-default-400 group-hover:text-foreground/85 transition-colors">
                {t("common.searchPlaceholder", "Buscar juegos, partidas y más...")}
              </span>
            </div>
            <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-default-400 bg-default-200/50 dark:bg-default-100/20 rounded-md border border-default-200/40 dark:border-default-100/10 pointer-events-none">
              <span>Ctrl</span>
              <span>K</span>
            </kbd>
          </button>
        </div>
      </div>

      {/* Zona derecha: Acciones y Controles de Ventana */}
      <div className="relative z-10 flex items-center gap-2 min-w-30 justify-end h-full">
        {onOpenBigPicture && (
          <Button
            isIconOnly
            variant="light"
            radius="full"
            size="sm"
            className={`h-8 w-8 min-w-0 transition-colors ${
              showTransparent
                ? "text-white/80 hover:text-white hover:bg-black/40 backdrop-blur-xs"
                : "text-default-400 hover:text-foreground hover:bg-default-100/50"
            }`}
            onPress={onOpenBigPicture}
            title={t("common.bigPictureMode", "Modo Big Picture")}
            aria-label={t("common.bigPictureMode", "Modo Big Picture")}>
            <Tv size={16} />
          </Button>
        )}

        {/* Controles de ventana nativos (solo en Windows / Linux) */}
        {!isMac && (
          <div className="flex items-center h-13 -mr-3">
            <WindowsControls
              close={close}
              minimize={minimize}
              maximize={maximize}
              isMaximized={isMaximized}
              labels={labels}
              showTitle={false}
              className="h-13"
            />
          </div>
        )}
      </div>
    </header>
  );
});

XboxTopHeader.displayName = "XboxTopHeader";
