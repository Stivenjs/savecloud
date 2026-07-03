import { Button, Card, CardBody, Switch } from "@heroui/react";
import { Beaker } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { useTranslation, Trans } from "react-i18next";

/** Coincide con `FULL_BACKUP_PACKAGED_ZSTD_DEFAULT` en el backend (histórico antes de esta opción). */
const PACKAGED_ZSTD_DEFAULT = 5;

const ZSTD_SLIDER_DEBOUNCE_MS = 400;

interface ExperimentalFeaturesCardProps {
  fullBackupStreaming: boolean;
  onFullBackupStreamingChange: (enabled: boolean) => void;
  fullBackupStreamingDryRun: boolean;
  onFullBackupStreamingDryRunChange: (enabled: boolean) => void;
  /** `undefined` o ausencia = usar predeterminado 5 en runtime. Solo lectura inicial (remount al cambiar perfil). */
  fullBackupPackagedCompressionLevel?: number | null;
  onFullBackupPackagedCompressionLevelChange: (level: number | null) => void | Promise<void>;
}

function levelFromProp(level: number | null | undefined): number {
  return typeof level === "number" ? level : PACKAGED_ZSTD_DEFAULT;
}

function persistedPayload(level: number): number | null {
  return level === PACKAGED_ZSTD_DEFAULT ? null : level;
}

export function ExperimentalFeaturesCard({
  fullBackupStreaming,
  onFullBackupStreamingChange,
  fullBackupStreamingDryRun,
  onFullBackupStreamingDryRunChange,
  fullBackupPackagedCompressionLevel,
  onFullBackupPackagedCompressionLevelChange,
}: ExperimentalFeaturesCardProps) {
  const { t } = useTranslation();
  const [localZstdLevel, setLocalZstdLevel] = useState(() => levelFromProp(fullBackupPackagedCompressionLevel));
  const debouncedZstdLevel = useDebouncedValue(localZstdLevel, ZSTD_SLIDER_DEBOUNCE_MS);
  const prevDebouncedZstd = useRef<number | undefined>(undefined);
  const skipNextDebouncedPersist = useRef(false);

  useEffect(() => {
    if (prevDebouncedZstd.current === undefined) {
      prevDebouncedZstd.current = debouncedZstdLevel;
      return;
    }
    if (prevDebouncedZstd.current === debouncedZstdLevel) return;
    prevDebouncedZstd.current = debouncedZstdLevel;
    if (skipNextDebouncedPersist.current) {
      skipNextDebouncedPersist.current = false;
      return;
    }
    void onFullBackupPackagedCompressionLevelChange(persistedPayload(debouncedZstdLevel));
  }, [debouncedZstdLevel, onFullBackupPackagedCompressionLevelChange]);

  const hasCustomZstdLevel = typeof fullBackupPackagedCompressionLevel === "number";

  return (
    <Card className="bg-default-50">
      <CardBody className="gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Beaker size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("settings.experimental.title")}</h2>
              <p className="mt-0.5 text-sm text-default-500">{t("settings.experimental.subtitle")}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-default-200 bg-default-100/50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-default-700">{t("settings.experimental.streamingBackup.title")}</p>
              <p className="mt-0.5 text-xs text-default-500">
                <Trans
                  i18nKey="settings.experimental.streamingBackup.desc"
                  components={{ code: <code className="font-mono bg-default-100 px-1 py-0.5 rounded text-xs" /> }}
                />
              </p>
            </div>
            <Switch isSelected={fullBackupStreaming} onValueChange={onFullBackupStreamingChange} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-default-200 bg-default-100/50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-default-700">{t("settings.experimental.dryRun.title")}</p>
              <p className="mt-0.5 text-xs text-default-500">
                <Trans i18nKey="settings.experimental.dryRun.desc" components={{ strong: <strong /> }} />
              </p>
            </div>
            <Switch isSelected={fullBackupStreamingDryRun} onValueChange={onFullBackupStreamingDryRunChange} />
          </div>

          <div className="rounded-lg border border-default-200 bg-default-100/50 px-3 py-3">
            <p className="text-sm font-medium text-default-700">{t("settings.experimental.compression.title")}</p>
            <p className="mt-1 text-xs text-default-500">
              <Trans
                i18nKey="settings.experimental.compression.desc"
                components={{
                  strong: <strong />,
                  code: <code className="font-mono bg-default-100 px-1 py-0.5 rounded text-xs" />,
                }}
              />
            </p>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="text-sm text-default-600" htmlFor="packaged-zstd-level">
                {t("settings.experimental.compression.levelLabel")}{" "}
                <span className="font-semibold tabular-nums text-foreground">{localZstdLevel}</span>
                {!hasCustomZstdLevel ? (
                  <span className="text-default-400">
                    {" "}
                    {t("settings.experimental.compression.defaultSuffix", { default: PACKAGED_ZSTD_DEFAULT })}
                  </span>
                ) : null}
              </label>
              <Button
                size="sm"
                variant="flat"
                className="shrink-0"
                isDisabled={!hasCustomZstdLevel && localZstdLevel === PACKAGED_ZSTD_DEFAULT}
                onPress={() => {
                  setLocalZstdLevel(PACKAGED_ZSTD_DEFAULT);
                  skipNextDebouncedPersist.current = true;
                  void onFullBackupPackagedCompressionLevelChange(null);
                }}>
                {t("settings.experimental.compression.restoreDefault")}
              </Button>
            </div>

            <input
              id="packaged-zstd-level"
              type="range"
              min={1}
              max={22}
              step={1}
              value={localZstdLevel}
              className="mt-2 h-2 w-full cursor-pointer accent-primary"
              aria-valuemin={1}
              aria-valuemax={22}
              aria-valuenow={localZstdLevel}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setLocalZstdLevel(n);
              }}
            />
            <p className="mt-1 text-[11px] text-default-400">{t("settings.experimental.compression.debounceHint")}</p>

            <div className="mt-3 border-t border-default-200/70 pt-3 dark:border-default-100/15">
              <p className="text-xs font-medium text-default-600">
                {t("settings.experimental.compression.prosConsTitle")}
              </p>
              <ul className="mt-2 space-y-1.5 pl-4 text-xs text-default-500 list-disc marker:text-default-400">
                <li>
                  <span className="font-medium text-default-600">
                    {t("settings.experimental.compression.lowLevels")}
                  </span>{" "}
                  {t("settings.experimental.compression.lowLevelsDesc")}
                </li>
                <li>
                  <span className="font-medium text-default-600">
                    {t("settings.experimental.compression.highLevels")}
                  </span>{" "}
                  {t("settings.experimental.compression.highLevelsDesc")}
                </li>
                <li>
                  <Trans
                    i18nKey="settings.experimental.compression.gameDataHint"
                    components={{ code: <code className="font-mono" /> }}
                  />
                </li>
              </ul>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
