import { useMemo, useState } from "react";
import { Button, Card, CardBody, Select, SelectItem } from "@heroui/react";
import { Gamepad2 } from "lucide-react";
import { featureFlags } from "@/constants/featureFlags";
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

const DIAGRAM_LAYOUT_OPTIONS: { id: DiagramLayoutChoice; label: string }[] = [
  { id: "auto", label: "Automático (según nombre del mando)" },
  { id: "xbox", label: "Xbox" },
  { id: "playstation", label: "PlayStation" },
  { id: "nintendo", label: "Nintendo Switch" },
  { id: "generic", label: "Genérico (leyendas tipo Xbox)" },
];

export function GamepadTesterCard() {
  const {
    isDesktop,
    gamepads,
    selectedId,
    setSelectedId,
    selectedKey,
    selectedTelemetry,
    selectedLayoutKind,
    selectedGamepadName,
    loadErr,
    rumbleErr,
    rumbleBusy,
    listRefreshing,
    refreshList,
    triggerRumble,
  } = useGamepadTester();

  const [diagramLayoutChoice, setDiagramLayoutChoice] = useState<DiagramLayoutChoice>("auto");

  const diagramLayoutKind = useMemo((): GamepadLayoutKind => {
    if (diagramLayoutChoice === "auto") return selectedLayoutKind;
    return diagramLayoutChoice;
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
            <h2 className="text-base font-semibold text-foreground">Tu mando</h2>
          </div>
          <p className="text-sm text-default-500">
            Esta prueba solo está disponible en la app de escritorio de Savecloud.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center gap-2">
          <Gamepad2 size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">Tu mando</h2>
        </div>
        <p className="text-sm text-default-500">
          Conecta el mando por cable o su adaptador inalámbrico. Con Savecloud o la ventana de Ajustes al frente verás
          cómo responden sticks y botones. El botón de vibración envía un pequeño pulso si el sistema lo permite (en
          algunos Mac no hay vibración).
        </p>
        <p className="text-xs text-default-400">
          {featureFlags.gamepadNavigation
            ? "Puedes usar el mando también para moverte por la app."
            : "Por ahora el mando se usa sobre todo aquí; moverte por toda la app con el mando depende de la configuración de tu compilación."}
        </p>

        {loadErr ? <p className="text-sm text-danger">{loadErr}</p> : null}

        {rumbleErr ? <p className="text-sm text-danger">{rumbleErr}</p> : null}

        {gamepads.length === 0 ? (
          <p className="text-sm text-default-500">No detectamos ningún mando. Enchufa uno y pulsa «Buscar de nuevo».</p>
        ) : (
          <>
            {selectedGamepadName ? (
              <p className="text-xs text-default-400">
                Detección por nombre «{selectedGamepadName}»: el perfil automático es{" "}
                {layoutKindDescription(selectedLayoutKind)}. Puedes fijar otro esquema abajo para la vista y las
                etiquetas.
              </p>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
              <Select
                label="¿Qué mando quieres mirar?"
                selectedKeys={selectedKey ? new Set([selectedKey]) : new Set()}
                onSelectionChange={(keys) => {
                  const k = Array.from(keys)[0];
                  if (k != null) setSelectedId(Number(k));
                }}
                className="max-w-md"
                size="sm"
                variant="bordered"
                aria-label="Elegir mando conectado">
                {gamepads.map((g) => (
                  <SelectItem key={String(g.id)} textValue={g.name}>
                    {g.name}
                  </SelectItem>
                ))}
              </Select>
              <Button
                size="sm"
                variant="light"
                isLoading={listRefreshing}
                onPress={() => void refreshList({ showLoading: true })}
                aria-label="Buscar mandos de nuevo">
                Buscar de nuevo
              </Button>
              <Button
                size="sm"
                color="primary"
                variant="flat"
                isDisabled={selectedId == null || rumbleBusy}
                onPress={() => void triggerRumble()}
                aria-label="Probar vibración del mando">
                Probar vibración
              </Button>
            </div>

            {selectedId != null ? (
              <div className="rounded-xl border border-default-200/70 bg-content1/40 p-4 dark:border-default-100/40">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <p className="text-center text-xs font-medium uppercase tracking-wide text-default-500 sm:text-left">
                    Vista del mando
                  </p>
                  <Select
                    label="Esquema visual"
                    selectedKeys={new Set([diagramLayoutChoice])}
                    onSelectionChange={(keys) => {
                      const raw = Array.from(keys)[0];
                      const k = raw != null ? String(raw) : "";
                      if (k === "auto" || k === "xbox" || k === "playstation" || k === "nintendo" || k === "generic") {
                        setDiagramLayoutChoice(k);
                      }
                    }}
                    className="min-w-[min(100%,280px)] sm:max-w-xs"
                    size="sm"
                    variant="bordered"
                    aria-label="Esquema del mando (silueta Kenney y leyendas)">
                    {DIAGRAM_LAYOUT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.id} textValue={opt.label}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
                <p className="mb-3 text-center text-[11px] text-default-400 sm:text-left">
                  Mostrando {layoutKindDescription(diagramLayoutKind)}
                  {diagramLayoutChoice === "auto" ? " (automático)." : " (elección manual)."}
                </p>
                <GamepadDiagram layoutKind={diagramLayoutKind} telemetry={diagramTelemetry} />
              </div>
            ) : null}

            {selectedTelemetry ? (
              <div className="grid gap-4 rounded-lg border border-default-200/80 bg-default-50/40 p-4 dark:border-default-100/60 dark:bg-default-100/10">
                <p className="text-xs font-medium uppercase tracking-wide text-default-500">Detalle numérico</p>
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
                  <p className="mb-1 text-xs text-default-500">Botones que detectamos ahora mismo</p>
                  {selectedTelemetry.pressed_buttons.length === 0 ? (
                    <p className="text-sm text-default-400">Ninguno pulsado. Prueba la cruceta o la cara de botones.</p>
                  ) : (
                    <p className="text-sm leading-relaxed text-default-800">
                      {formatPressedButtonsDisplay(diagramLayoutKind, selectedTelemetry.pressed_buttons)}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-default-500">
                Toca algo del mando: con la ventana de Savecloud o Ajustes activa deberían aparecer números y nombres
                claros arriba.
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
