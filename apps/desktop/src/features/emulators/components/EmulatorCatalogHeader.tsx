import { Chip, Input } from "@heroui/react";
import { Gamepad2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

interface EmulatorCatalogHeaderProps {
  emulatorCount: number;
  installedCount: number;
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
}

/** Encabezado, contador de estado y filtro textual del catálogo. */
export function EmulatorCatalogHeader({
  emulatorCount,
  installedCount,
  isLoading,
  search,
  onSearchChange,
}: EmulatorCatalogHeaderProps) {
  const { t } = useTranslation();

  return (
    <>
      <header className="flex flex-col gap-4 border-b border-default-200/70 pb-5 sm:flex-row sm:items-end sm:justify-between dark:border-default-100/15">
        <div className="max-w-2xl">
          <p className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-primary">
            <Gamepad2 size={14} />
            {t("settings.emulators.marketplaceEyebrow")}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("settings.emulators.marketplaceTitle")}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-default-500">
            {t("settings.emulators.marketplaceSubtitle")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-default-500">
          <Chip size="sm" variant="flat" color="primary" className="h-6">
            {t("settings.emulators.catalogCount", { count: emulatorCount })}
          </Chip>
          {!isLoading && (
            <span className="font-mono tabular-nums">
              {t("settings.emulators.installedCount", { count: installedCount })}
            </span>
          )}
        </div>
      </header>

      <div className="max-w-xl">
        <Input
          value={search}
          onValueChange={onSearchChange}
          placeholder={t("settings.emulators.searchPlaceholder")}
          aria-label={t("settings.emulators.searchPlaceholder")}
          startContent={<Search size={15} className="text-default-400" />}
          isClearable
          onClear={() => onSearchChange("")}
          classNames={{
            inputWrapper: "h-10 border border-default-200/70 bg-default-50/50 shadow-none dark:border-default-100/15",
            input: "text-sm",
          }}
        />
      </div>
    </>
  );
}
