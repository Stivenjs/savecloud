import { Button } from "@heroui/react";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface DownloadsHeaderProps {
  totalActive: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  consoleMode?: boolean;
}

export function DownloadsHeader({
  totalActive,
  collapsed,
  onToggleCollapse,
  consoleMode = false,
}: DownloadsHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className={`flex items-center justify-between ${consoleMode ? "mb-4" : "mb-3"}`}>
      <div className={`flex items-center ${consoleMode ? "gap-3.5" : "gap-2.5"}`}>
        <div
          className={`flex items-center justify-center rounded-xl text-primary ${
            consoleMode ? "h-11 w-11 bg-primary/15" : "h-8 w-8 rounded-lg bg-primary/10"
          }`}>
          <Download size={consoleMode ? 22 : 16} className="text-primary" strokeWidth={2.2} />
        </div>
        <div>
          <p className={`font-bold leading-tight ${consoleMode ? "text-base sm:text-lg" : "text-sm font-semibold"}`}>
            {t("downloads.title")}
          </p>
          <p className={`text-default-400 ${consoleMode ? "text-xs sm:text-sm mt-0.5" : "text-xs"}`}>
            {t("downloads.active", { count: totalActive })}
          </p>
        </div>
      </div>
      <Button
        isIconOnly
        size={consoleMode ? "md" : "sm"}
        variant="flat"
        radius="lg"
        aria-label={collapsed ? t("downloads.expand") : t("downloads.collapse")}
        className={consoleMode ? "h-10 w-10 min-w-10 hover:bg-default-200/80" : ""}
        onPress={onToggleCollapse}>
        {collapsed ? <ChevronUp size={consoleMode ? 20 : 16} /> : <ChevronDown size={consoleMode ? 20 : 16} />}
      </Button>
    </div>
  );
}
