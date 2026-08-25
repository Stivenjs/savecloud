import { Search, Tv } from "lucide-react";
import { Button, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useTauriWindow, WindowsControls, MacControls } from "@components/layout/TitleBar";

export interface XboxTopHeaderProps {
  onOpenSearch: () => void;
  onOpenBigPicture?: () => void;
  className?: string;
}

export function XboxTopHeader({ onOpenSearch, onOpenBigPicture, className }: XboxTopHeaderProps) {
  const { t } = useTranslation();
  const { isMaximized, platform, minimize, maximize, close } = useTauriWindow();
  const isMac = platform === "macos";

  const labels = {
    close: t("common.close", "Cerrar"),
    minimize: t("common.minimize", "Minimizar"),
    maximize: t("common.maximize", "Maximizar"),
    restore: t("common.restore", "Restaurar"),
  };

  return (
    <header
      data-tauri-drag-region
      className={`fixed top-0 left-17 right-0 h-13 z-30 flex items-center justify-between px-3 bg-background/70 dark:bg-background/80 backdrop-blur-xl border-b border-default-200/30 dark:border-default-100/10 select-none shadow-xs ${
        className ?? ""
      }`}>
      {/* Zona izquierda: Arrastre nativo de ventana */}
      <div data-tauri-drag-region className="flex items-center gap-3 min-w-30 h-full">
        {isMac ? (
          <div className="flex items-center gap-1.5 pl-1">
            <MacControls close={close} minimize={minimize} maximize={maximize} labels={labels} />
          </div>
        ) : null}
      </div>

      {/* Centro: Buscador global estilo Xbox (Ctrl + K) */}
      <div data-tauri-drag-region className="flex items-center justify-center flex-1 max-w-xl px-2 h-full">
        <button
          type="button"
          onClick={onOpenSearch}
          className="group relative flex items-center justify-between w-full max-w-md h-8.5 px-3.5 rounded-full bg-default-100/80 hover:bg-default-200/60 dark:bg-default-50/15 dark:hover:bg-default-100/25 border border-default-200/60 dark:border-default-100/15 transition-all duration-200 text-default-400 hover:text-foreground shadow-xs cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
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

      {/* Zona derecha: Acciones y Controles de Ventana */}
      <div className="flex items-center gap-2 min-w-30 justify-end h-full">
        {onOpenBigPicture && (
          <Tooltip content={t("common.bigPictureMode", "Modo Big Picture")} placement="bottom" delay={200}>
            <Button
              isIconOnly
              variant="light"
              radius="full"
              size="sm"
              className="h-8 w-8 min-w-0 text-default-400 hover:text-foreground hover:bg-default-100/50"
              onPress={onOpenBigPicture}
              aria-label={t("common.bigPictureMode", "Modo Big Picture")}>
              <Tv size={16} />
            </Button>
          </Tooltip>
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
}
