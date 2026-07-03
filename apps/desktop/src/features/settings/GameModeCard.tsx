import { useCallback, useMemo, useTransition } from "react";
import { Card, CardBody, Checkbox, Switch } from "@heroui/react";
import { type as getOsType } from "@tauri-apps/plugin-os";
import { Gamepad2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { CONFIG_QUERY_KEY, useConfig } from "@hooks/useConfig";
import {
  gameModeRefresh,
  gameModeSetEnabled,
  setGameModeApplyPowerProfile,
  setGameModeBoostDetectedGameCpu,
  setGameModeReduceCaptureOverhead,
  setGameModeThrottleSavecloudBackground,
} from "@services/tauri";
import { toastError } from "@utils/toast";

function invalidateConfig(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
}

/** Opciones modestas sin privilegios de administrador obligatorios. */
export function GameModeCard() {
  const { t } = useTranslation();
  const { config, loading, refetch } = useConfig();
  const qc = useQueryClient();
  const [mainPending, startMainTransition] = useTransition();

  const os = useMemo(() => getOsType(), []);
  const isWindows = os === "windows";

  const onMainToggle = useCallback(
    (next: boolean) => {
      startMainTransition(async () => {
        try {
          await gameModeSetEnabled(next);
          invalidateConfig(qc);
          await refetch();
        } catch (e) {
          toastError((e instanceof Error ? e.message : String(e)) || "No se pudo cambiar modo juego");
        }
      });
    },
    [qc, refetch]
  );

  const saveOptionThenRefreshOs = useCallback(
    async (setter: () => Promise<void>) => {
      try {
        await setter();
        await gameModeRefresh();
        invalidateConfig(qc);
        await refetch();
      } catch (e) {
        toastError((e instanceof Error ? e.message : String(e)) || "Error al guardar opción");
      }
    },
    [qc, refetch]
  );

  const gmEnabled = !!config?.gameModeEnabled;

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Gamepad2 size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("settings.gameMode.title")}</h2>
              <p className="mt-0.5 text-sm text-default-500">{t("settings.gameMode.subtitle")}</p>
            </div>
          </div>
          <Switch
            isSelected={gmEnabled}
            onValueChange={onMainToggle}
            isDisabled={loading || mainPending}
            aria-label={t("settings.gameMode.ariaLabel")}
          />
        </div>

        <div className="rounded-medium border-small border-divider px-4 py-3 space-y-3">
          <Checkbox
            classNames={{
              base: "max-w-full w-full items-start",
              label: "w-full",
            }}
            isSelected={!!config?.gameModeThrottleSavecloudBackground}
            onValueChange={(v) => void saveOptionThenRefreshOs(() => setGameModeThrottleSavecloudBackground(v))}
            isDisabled={loading}>
            <div className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">{t("settings.gameMode.pauseTraffic")}</span>
              <span className="block text-xs text-default-500 leading-relaxed font-normal">
                {t("settings.gameMode.pauseTrafficDesc")}
              </span>
            </div>
          </Checkbox>

          <Checkbox
            classNames={{
              base: "max-w-full w-full items-start",
              label: "w-full",
            }}
            isSelected={!!config?.gameModeApplyPowerProfile}
            onValueChange={(v) => void saveOptionThenRefreshOs(() => setGameModeApplyPowerProfile(v))}
            isDisabled={loading}>
            <div className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">{t("settings.gameMode.powerProfile")}</span>
              <span className="block text-xs text-default-500 leading-relaxed font-normal">
                {isWindows ? t("settings.gameMode.powerProfileWin") : t("settings.gameMode.powerProfileOther")}
              </span>
            </div>
          </Checkbox>

          <Checkbox
            classNames={{
              base: "max-w-full w-full items-start",
              label: "w-full",
            }}
            isSelected={!!config?.gameModeReduceCaptureOverhead}
            onValueChange={(v) => void saveOptionThenRefreshOs(() => setGameModeReduceCaptureOverhead(v))}
            isDisabled={loading || !isWindows}>
            <div className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">{t("settings.gameMode.gameBar")}</span>
              <span className="block text-xs text-default-500 leading-relaxed font-normal">
                {t("settings.gameMode.gameBarDesc")}
              </span>
            </div>
          </Checkbox>

          <Checkbox
            classNames={{
              base: "max-w-full w-full items-start",
              label: "w-full",
            }}
            isSelected={!!config?.gameModeBoostDetectedGameCpu}
            onValueChange={(v) => void saveOptionThenRefreshOs(() => setGameModeBoostDetectedGameCpu(v))}
            isDisabled={loading}>
            <div className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">{t("settings.gameMode.cpuPriority")}</span>
              <span className="block text-xs text-default-500 leading-relaxed font-normal">
                {t("settings.gameMode.cpuPriorityDesc")}
              </span>
            </div>
          </Checkbox>
        </div>
      </CardBody>
    </Card>
  );
}
