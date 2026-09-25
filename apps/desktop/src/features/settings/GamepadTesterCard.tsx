import { useMemo } from "react";
import { Button, Card, CardBody, Select, SelectItem } from "@heroui/react";
import { Gamepad2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GamepadDiagram } from "@/features/settings/GamepadDiagram";
import {
  axisRowCopy,
  formatPressedButtonsDisplay,
  layoutKindDescription,
  type GamepadLayoutKind,
} from "@/lib/gamepadLabelMaps";
import {
  formatGamepadFloat,
  gamepadAxisValue,
  gamepadTriggerLevel,
  useGamepadTester,
  type GamepadTelemetryDto,
} from "@/hooks/useGamepadTester";

/** Cómo dibujar el HUD Kenney y las leyendas; «auto» usa la heurística por nombre USB/del SO. */
type DiagramLayoutChoice = "auto" | GamepadLayoutKind;

export function GamepadTesterCard() {
  const { t } = useTranslation();
  const {
    isDesktop,
    isWindowsDesktop,
    gamepads,
    selectedId,
    setSelectedId,
    selectedKey,
    selectedTelemetry,
    selectedLayoutKind,
    preferredLayoutKind,
    setPreferredLayoutKind,
    selectedGamepadName,
    loadErr,
    rumbleErr,
    rumbleBusy,
    driverInstallBusy,
    listRefreshing,
    refreshList,
    triggerRumble,
    installGamepadDriver,
  } = useGamepadTester();

  const DIAGRAM_LAYOUT_OPTIONS: { id: DiagramLayoutChoice; label: string }[] = useMemo(
    () => [
      { id: "auto", label: t("settings.gamepadTester.layoutOptions.auto") },
      { id: "xbox", label: "Xbox" },
      { id: "playstation", label: "PlayStation" },
      { id: "nintendo", label: "Nintendo Switch" },
      { id: "generic", label: t("settings.gamepadTester.layoutOptions.generic") },
    ],
    [t]
  );

  const diagramLayoutChoice: DiagramLayoutChoice = preferredLayoutKind ?? "auto";

  const diagramLayoutKind = useMemo((): GamepadLayoutKind => {
    return diagramLayoutChoice === "auto" ? selectedLayoutKind : diagramLayoutChoice;
  }, [diagramLayoutChoice, selectedLayoutKind]);

  const axisLabels = axisRowCopy(diagramLayoutKind);

  const emptyTelemetry = useMemo((): GamepadTelemetryDto => {
    return {
      id: selectedId ?? -1,
      name: selectedGamepadName ?? "",
      axes: {},
      pressed_buttons: [],
      button_values: {},
    };
  }, [selectedId, selectedGamepadName]);

  const diagramTelemetry = selectedTelemetry ?? emptyTelemetry;

  const detailPressed = useMemo(() => {
    if (!selectedTelemetry) return new Set<string>();
    return new Set(selectedTelemetry.pressed_buttons.map((p) => p.trim()));
  }, [selectedTelemetry]);

  if (!isDesktop) {
    return (
      <Card>
        <CardBody className="gap-3">
          <div className="flex items-center gap-2">
            <Gamepad2 size={20} className="text-default-500" />
            <h2 className="text-base font-semibold text-foreground">{t("settings.gamepadTester.title")}</h2>
          </div>
          <p className="text-sm text-default-500">{t("settings.gamepadTester.desktopOnlyDesc")}</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center gap-2">
          <Gamepad2 size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">{t("settings.gamepadTester.title")}</h2>
        </div>
        <p className="text-sm text-default-500">{t("settings.gamepadTester.mainDesc")}</p>
        <p className="text-xs text-default-400">{t("settings.gamepadTester.navDesc")}</p>

        {loadErr ? <p className="text-sm text-danger">{loadErr}</p> : null}

        {rumbleErr ? <p className="text-sm text-danger">{rumbleErr}</p> : null}
        {gamepads.length === 0 ? (
          <p className="text-sm text-default-500">{t("settings.gamepadTester.noGamepadFound")}</p>
        ) : selectedGamepadName ? (
          <p className="text-xs text-default-400">
            {t("settings.gamepadTester.detectionInfo", {
              name: selectedGamepadName,
              profile: layoutKindDescription(selectedLayoutKind),
            })}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
          {gamepads.length > 0 && (
            <Select
              label={t("settings.gamepadTester.selectLabel")}
              selectedKeys={selectedKey ? new Set([selectedKey]) : new Set()}
              onSelectionChange={(keys) => {
                const k = Array.from(keys)[0];
                if (k != null) setSelectedId(Number(k));
              }}
              className="max-w-md w-full"
              size="sm"
              variant="bordered"
              aria-label={t("settings.gamepadTester.selectLabel")}>
              {gamepads.map((g) => (
                <SelectItem key={String(g.id)} textValue={g.name}>
                  {g.name}
                </SelectItem>
              ))}
            </Select>
          )}
          <Button
            size="sm"
            variant="flat"
            isLoading={listRefreshing}
            onPress={() => void refreshList({ showLoading: true })}
            aria-label={t("settings.gamepadTester.searchButton")}>
            {t("settings.gamepadTester.searchButton")}
          </Button>
          {gamepads.length > 0 && (
            <Button
              size="sm"
              variant="flat"
              color="primary"
              isDisabled={selectedId == null || rumbleBusy}
              onPress={() => void triggerRumble()}
              aria-label={t("settings.gamepadTester.rumbleButton")}>
              {t("settings.gamepadTester.rumbleButton")}
            </Button>
          )}
          {isWindowsDesktop ? (
            <Button
              size="sm"
              color="secondary"
              variant="flat"
              isLoading={driverInstallBusy}
              isDisabled={driverInstallBusy}
              onPress={() => void installGamepadDriver()}
              aria-label={t("settings.gamepadTester.installDriversButton")}>
              {t("settings.gamepadTester.installDriversButton")}
            </Button>
          ) : null}
        </div>

        {gamepads.length > 0 ? (
          <>
            {selectedId != null ? (
              <div className="rounded-xl border border-default-200/70 bg-content1/40 p-4 dark:border-default-100/40">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <p className="text-center text-xs font-medium uppercase tracking-wide text-default-500 sm:text-left">
                    {t("settings.gamepadTester.diagramViewTitle")}
                  </p>
                  <Select
                    label={t("settings.gamepadTester.visualLayoutLabel")}
                    selectedKeys={new Set([diagramLayoutChoice])}
                    onSelectionChange={(keys) => {
                      const raw = Array.from(keys)[0];
                      const k = raw != null ? String(raw) : "";
                      if (k === "auto") {
                        void setPreferredLayoutKind(null);
                        return;
                      }
                      if (k === "xbox" || k === "playstation" || k === "nintendo" || k === "generic") {
                        void setPreferredLayoutKind(k);
                      }
                    }}
                    className="min-w-[min(100%,280px)] sm:max-w-xs"
                    size="sm"
                    variant="bordered"
                    aria-label={t("settings.gamepadTester.visualLayoutLabel")}>
                    {DIAGRAM_LAYOUT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} textValue={opt.label}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
                <p className="mb-3 text-center text-[11px] text-default-400 sm:text-left">
                  {t("settings.gamepadTester.showingLayout", { layout: layoutKindDescription(diagramLayoutKind) })}
                  {diagramLayoutChoice === "auto"
                    ? t("settings.gamepadTester.autoChoice")
                    : t("settings.gamepadTester.manualChoice")}
                </p>
                <GamepadDiagram layoutKind={diagramLayoutKind} telemetry={diagramTelemetry} />
              </div>
            ) : null}

            {selectedTelemetry ? (
              <div className="grid gap-4 rounded-lg border border-default-200/80 bg-default-50/40 p-4 dark:border-default-100/60 dark:bg-default-100/10">
                <p className="text-xs font-medium uppercase tracking-wide text-default-500">
                  {t("settings.gamepadTester.numericDetailTitle")}
                </p>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <span className="text-default-600">{axisLabels.triggers.left}: </span>
                    <span className="font-mono tabular-nums text-default-800">
                      {formatGamepadFloat(
                        gamepadTriggerLevel(
                          selectedTelemetry.axes,
                          selectedTelemetry.button_values,
                          detailPressed,
                          "left"
                        )
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-default-600">{axisLabels.triggers.right}: </span>
                    <span className="font-mono tabular-nums text-default-800">
                      {formatGamepadFloat(
                        gamepadTriggerLevel(
                          selectedTelemetry.axes,
                          selectedTelemetry.button_values,
                          detailPressed,
                          "right"
                        )
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-default-600">{axisLabels.sticks.left} (↔ · ↕): </span>
                    <span className="font-mono tabular-nums text-default-800">
                      {formatGamepadFloat(gamepadAxisValue(selectedTelemetry.axes, "LeftStickX"))},{" "}
                      {formatGamepadFloat(gamepadAxisValue(selectedTelemetry.axes, "LeftStickY"))}
                    </span>
                  </div>
                  <div>
                    <span className="text-default-600">{axisLabels.sticks.right} (↔ · ↕): </span>
                    <span className="font-mono tabular-nums text-default-800">
                      {formatGamepadFloat(gamepadAxisValue(selectedTelemetry.axes, "RightStickX"))},{" "}
                      {formatGamepadFloat(gamepadAxisValue(selectedTelemetry.axes, "RightStickY"))}
                    </span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-default-600">{axisLabels.dpad}: </span>
                    <span className="font-mono tabular-nums text-default-800">
                      {formatGamepadFloat(gamepadAxisValue(selectedTelemetry.axes, "DPadX"))},{" "}
                      {formatGamepadFloat(gamepadAxisValue(selectedTelemetry.axes, "DPadY"))}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs text-default-500">{t("settings.gamepadTester.buttonsDetectedTitle")}</p>
                  {selectedTelemetry.pressed_buttons.length === 0 ? (
                    <p className="text-sm text-default-400">{t("settings.gamepadTester.noButtonsPressed")}</p>
                  ) : (
                    <p className="text-sm leading-relaxed text-default-800">
                      {formatPressedButtonsDisplay(diagramLayoutKind, selectedTelemetry.pressed_buttons)}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-default-500">{t("settings.gamepadTester.telemetryHelp")}</p>
            )}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
