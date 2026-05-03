import { useId } from "react";
import type { GamepadLayoutKind } from "@/lib/gamepadLabelMaps";
import {
  getKenneyGamepadAssetUrl,
  kenneyDpadAssetId,
  kenneyFaceAssetId,
  type DpadDir,
  type FaceButtonKey,
} from "@/lib/kenneyGamepadAssets";
import type { GamepadTelemetryDto } from "@/hooks/useGamepadTester";
import { isActive, padShape, padText, STICK_DEADZONE } from "@/constants/gamepadDiagramConstants";
import { useGamepadDiagram } from "@/hooks/useGamepadDiagram";

function KenneySvgImage(props: {
  href: string | undefined;
  cx: number;
  cy: number;
  w: number;
  h: number;
  active: boolean;
  opacityIdle?: number;
  /** Alinear el dibujo al borde inferior del rect (hombreras pegadas al cuerpo del mando). */
  pinBottom?: boolean;
}) {
  const { href, cx, cy, w, h, active, opacityIdle = 0.38, pinBottom = false } = props;
  if (!href) return null;
  const o = active ? 1 : opacityIdle;
  return (
    <image
      href={href}
      x={cx - w / 2}
      y={cy - h / 2}
      width={w}
      height={h}
      preserveAspectRatio={pinBottom ? "xMidYMax meet" : "xMidYMid meet"}
      opacity={o}
    />
  );
}

/** Gatillo analógico Kenney: capa tenue + la misma imagen recortada desde abajo según `value` (0–1). */
function KenneyAnalogTriggerMeter(props: {
  href: string | undefined;
  cx: number;
  cy: number;
  w: number;
  h: number;
  value: number;
  clipId: string;
}) {
  const { href, cx, cy, w, h, value, clipId } = props;
  const x = cx - w / 2;
  const v = Math.max(0, Math.min(1, value));
  if (!href) {
    return (
      <g aria-hidden>
        <rect
          x={x}
          y={cy - h / 2}
          width={w}
          height={h}
          rx={Math.min(6, w * 0.15)}
          className="fill-default-200/45 dark:fill-default-100/15"
        />
        <rect
          x={x}
          y={cy - h / 2 + h * (1 - v)}
          width={w}
          height={h * v}
          rx={Math.min(6, w * 0.15)}
          className={v > 0.04 ? "fill-primary/85" : "fill-primary/12"}
        />
      </g>
    );
  }
  const y = cy - h / 2;
  const clipH = Math.max(0, h * v);
  const clipY = y + h - clipH;

  return (
    <g aria-hidden>
      <defs>
        <clipPath id={clipId}>
          <rect x={x} y={clipY} width={w} height={clipH} />
        </clipPath>
      </defs>
      <image
        href={href}
        x={x}
        y={y}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMax meet"
        opacity={0.26}
        className="dark:opacity-[0.22]"
      />
      <image
        href={href}
        x={x}
        y={y}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMax meet"
        clipPath={`url(#${clipId})`}
        opacity={v > 0.04 ? 1 : 0.12}
        className={v > 0.04 ? "brightness-110 saturate-[1.25]" : undefined}
      />
    </g>
  );
}

interface GamepadDiagramProps {
  layoutKind: GamepadLayoutKind;
  telemetry: GamepadTelemetryDto;
  className?: string;
}

/**
 * Esquema del mando con resaltado según telemetría gilrs (botones y ejes).
 * Silueta Kenney 64×64 por plataforma; HUD en el mismo espacio de coordenadas.
 */
export function GamepadDiagram({ layoutKind, telemetry, className = "" }: GamepadDiagramProps) {
  const triggerClipBase = useId().replace(/:/g, "");
  const {
    set,
    lx,
    ly,
    rx,
    ry,
    lz,
    rz,
    leftNubOuter,
    rightNubOuter,
    leftNubShell,
    rightNubShell,
    d,
    face,
    selectHref,
    startHref,
    modeHref,
    leftStickDecal,
    rightStickDecal,
    leftStickPress,
    rightStickPress,
    leftTriggerHref,
    rightTriggerHref,
    leftBumperHref,
    rightBumperHref,
    geom,
    shellHref,
    iconGeom,
    tt,
    svgViewBox,
    bumperOn,
    shellPadX,
    shellPadY,
    shellIconScale,
    triggerBarH,
  } = useGamepadDiagram({ layoutKind, telemetry });

  /** LB/RB debajo, LT/RT encima (orden SVG + geometría sin solape). */
  const [shLx, shLy, shLw, shLh] = iconGeom.shoulderL;
  const [shRx, shRy, shRw, shRh] = iconGeom.shoulderR;
  const shellLtCx = shLx + shLw / 2;
  const shellRtCx = shRx + shRw / 2;

  const shellBumperW = shLw * 2.45;
  const shellBumperH = Math.max(shLh * 3.75, 3.85);
  /** Sin tope, max(w,h)~21: el cuadrado de LB/RB sube y cubre por completo LT/RT. */
  const shellBumperSide = Math.min(Math.max(shellBumperW, shellBumperH), 9.6);
  const shellShoulderSnapY = 0.42;
  const shellBumperDrop = 0.35;
  const shellBumperBottomL = shLy + shLh + shellShoulderSnapY;
  const shellBumperBottomR = shRy + shRh + shellShoulderSnapY;
  const shellBumperCyL = shellBumperBottomL - shellBumperSide / 2 + shellBumperDrop;
  const shellBumperCyR = shellBumperBottomR - shellBumperSide / 2 + shellBumperDrop;

  const shellBumperTop = Math.min(shellBumperCyL - shellBumperSide / 2, shellBumperCyR - shellBumperSide / 2);
  const shellShoulderGap = 2.15;
  const shellTriggerH = Math.min(tt.h * 1.05, 8.25);
  const shellTriggerW = tt.w * 2.05;
  /** Borde inferior LT/RT queda `shellShoulderGap` por encima del borde superior LB/RB. */
  const shellTriggerCy = shellBumperTop - shellShoulderGap - shellTriggerH / 2;

  const [gumLx, gumLy, gumLw, gumLh] = geom.shoulderL;
  const [gumRx, gumRy, gumRw, gumRh] = geom.shoulderR;
  const legacyLtCx = gumLx + gumLw / 2;
  const legacyRtCx = gumRx + gumRw / 2;
  const legacyBumperW = gumLw * 0.95;
  const legacyBumperH = Math.max(gumLh * 1.5, 20);
  const legacyBumperSide = Math.min(Math.max(legacyBumperW, legacyBumperH), 52);
  const legacyShoulderSnapY = 3;
  const legacyBumperDrop = 2;
  const legacyBumperBottomL = gumLy + gumLh + legacyShoulderSnapY;
  const legacyBumperBottomR = gumRy + gumRh + legacyShoulderSnapY;
  const legacyBumperCyL = legacyBumperBottomL - legacyBumperSide / 2 + legacyBumperDrop;
  const legacyBumperCyR = legacyBumperBottomR - legacyBumperSide / 2 + legacyBumperDrop;
  const legacyBumperTop = Math.min(legacyBumperCyL - legacyBumperSide / 2, legacyBumperCyR - legacyBumperSide / 2);
  const legacyShoulderGap = 14;
  const legacyTrigH = Math.min(triggerBarH * 0.92, 44);
  const legacyTrigCy = legacyBumperTop - legacyShoulderGap - legacyTrigH / 2;

  return (
    <div className={`mx-auto w-full max-w-[720px] ${className}`}>
      <svg
        viewBox={svgViewBox}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label="Esquema del mando con el estado actual de botones y sticks">
        <defs>
          <filter id="gamepad-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.12" />
          </filter>
        </defs>

        {shellHref ? (
          <g transform={`translate(${shellPadX},${shellPadY}) scale(${shellIconScale})`}>
            <image
              href={shellHref}
              x={0}
              y={0}
              width={64}
              height={64}
              preserveAspectRatio="xMidYMid meet"
              className="opacity-95 dark:opacity-90"
              filter="url(#gamepad-soft-shadow)"
            />

            <g aria-hidden>
              <g>
                <title>Hombrera izquierda (LB / L1 / L)</title>
                {leftBumperHref ? (
                  <KenneySvgImage
                    href={leftBumperHref}
                    cx={shLx + shLw / 2}
                    cy={shellBumperCyL}
                    w={shellBumperSide}
                    h={shellBumperSide}
                    active={bumperOn("left")}
                    opacityIdle={0.36}
                    pinBottom
                  />
                ) : (
                  <rect x={shLx} y={shLy} width={shLw} height={shLh} rx={0.8} className={padShape(bumperOn("left"))} />
                )}
              </g>
              <g>
                <title>Hombrera derecha (RB / R1 / R)</title>
                {rightBumperHref ? (
                  <KenneySvgImage
                    href={rightBumperHref}
                    cx={shRx + shRw / 2}
                    cy={shellBumperCyR}
                    w={shellBumperSide}
                    h={shellBumperSide}
                    active={bumperOn("right")}
                    opacityIdle={0.36}
                    pinBottom
                  />
                ) : (
                  <rect x={shRx} y={shRy} width={shRw} height={shRh} rx={0.8} className={padShape(bumperOn("right"))} />
                )}
              </g>
            </g>

            <g aria-hidden>
              <KenneyAnalogTriggerMeter
                href={leftTriggerHref}
                cx={shellLtCx}
                cy={shellTriggerCy}
                w={shellTriggerW}
                h={shellTriggerH}
                value={lz}
                clipId={`${triggerClipBase}-slt`}
              />
              <KenneyAnalogTriggerMeter
                href={rightTriggerHref}
                cx={shellRtCx}
                cy={shellTriggerCy}
                w={shellTriggerW}
                h={shellTriggerH}
                value={rz}
                clipId={`${triggerClipBase}-srt`}
              />
            </g>

            <g transform={`translate(${iconGeom.dpad[0]},${iconGeom.dpad[1]})`} aria-hidden>
              <circle
                r={1.8}
                className="fill-default-900/20 stroke-default-900/35 dark:fill-default-100/12 dark:stroke-default-100/30"
                strokeWidth={0.25}
              />
              {(
                [
                  ["up", 0, -2.6],
                  ["down", 0, 2.6],
                  ["left", -2.6, 0],
                  ["right", 2.6, 0],
                ] as const
              ).map(([dir, ox, oy]) => {
                const ddir = dir as DpadDir;
                const href = getKenneyGamepadAssetUrl(layoutKind, kenneyDpadAssetId(layoutKind, ddir));
                const on = d[ddir];
                return (
                  <g key={dir} transform={`translate(${ox},${oy})`}>
                    <KenneySvgImage href={href} cx={0} cy={0} w={2.9} h={2.9} active={on} opacityIdle={0.35} />
                  </g>
                );
              })}
            </g>

            <g transform={`translate(${iconGeom.stickL[0]}, ${iconGeom.stickL[1]})`}>
              <circle
                r={iconGeom.stickRingR}
                className="fill-none stroke-default-900/45 dark:stroke-default-100/40"
                strokeWidth={0.35}
              />
              <circle
                r={iconGeom.stickNubR}
                className="fill-primary stroke-primary-900 stroke-[0.2px] dark:stroke-primary-100"
                transform={`translate(${leftNubShell.x}, ${leftNubShell.y})`}
              />
            </g>

            <g transform={`translate(${iconGeom.stickR[0]}, ${iconGeom.stickR[1]})`}>
              <circle
                r={iconGeom.stickRingR}
                className="fill-none stroke-default-900/45 dark:stroke-default-100/40"
                strokeWidth={0.35}
              />
              <circle
                r={iconGeom.stickNubR}
                className="fill-primary stroke-primary-900 stroke-[0.2px] dark:stroke-primary-100"
                transform={`translate(${rightNubShell.x}, ${rightNubShell.y})`}
              />
            </g>

            {selectHref ? (
              <KenneySvgImage
                href={selectHref}
                cx={iconGeom.select[0]}
                cy={iconGeom.select[1]}
                w={iconGeom.centerIcon}
                h={iconGeom.centerIcon}
                active={isActive(set, "Select")}
                opacityIdle={0.42}
              />
            ) : (
              <>
                <ellipse
                  cx={iconGeom.select[0]}
                  cy={iconGeom.select[1]}
                  rx={3.2}
                  ry={1.6}
                  className={padShape(isActive(set, "Select"))}
                />
                <text
                  x={iconGeom.select[0]}
                  y={iconGeom.select[1] + 0.6}
                  textAnchor="middle"
                  className={`pointer-events-none text-[1.8px] font-medium ${padText(isActive(set, "Select"))}`}>
                  Sel.
                </text>
              </>
            )}

            {startHref ? (
              <KenneySvgImage
                href={startHref}
                cx={iconGeom.start[0]}
                cy={iconGeom.start[1]}
                w={iconGeom.centerIcon}
                h={iconGeom.centerIcon}
                active={isActive(set, "Start")}
                opacityIdle={0.42}
              />
            ) : (
              <>
                <ellipse
                  cx={iconGeom.start[0]}
                  cy={iconGeom.start[1]}
                  rx={3.2}
                  ry={1.6}
                  className={padShape(isActive(set, "Start"))}
                />
                <text
                  x={iconGeom.start[0]}
                  y={iconGeom.start[1] + 0.6}
                  textAnchor="middle"
                  className={`pointer-events-none text-[1.8px] font-medium ${padText(isActive(set, "Start"))}`}>
                  Start
                </text>
              </>
            )}

            {modeHref ? (
              <KenneySvgImage
                href={modeHref}
                cx={iconGeom.mode[0]}
                cy={iconGeom.mode[1]}
                w={iconGeom.centerIcon + 0.4}
                h={iconGeom.centerIcon + 0.4}
                active={isActive(set, "Mode")}
                opacityIdle={0.42}
              />
            ) : (
              <>
                <circle
                  cx={iconGeom.mode[0]}
                  cy={iconGeom.mode[1]}
                  r={1.8}
                  className={padShape(isActive(set, "Mode"))}
                />
                <text
                  x={iconGeom.mode[0]}
                  y={iconGeom.mode[1] + 0.6}
                  textAnchor="middle"
                  className={`pointer-events-none text-[2px] font-semibold ${padText(isActive(set, "Mode"))}`}>
                  ⧉
                </text>
              </>
            )}

            <g style={{ fontFamily: "system-ui, sans-serif" }}>
              {(["North", "West", "East", "South"] as const).map((key) => {
                const faceKey = key as FaceButtonKey;
                const [cx, cy] = iconGeom.face[faceKey];
                const href = getKenneyGamepadAssetUrl(layoutKind, kenneyFaceAssetId(layoutKind, faceKey));
                const on = isActive(set, faceKey);
                const label = face[faceKey.toLowerCase() as "north" | "south" | "east" | "west"];
                return (
                  <g key={key}>
                    <title>{label}</title>
                    {href ? (
                      <KenneySvgImage
                        href={href}
                        cx={cx}
                        cy={cy}
                        w={iconGeom.faceIcon}
                        h={iconGeom.faceIcon}
                        active={on}
                        opacityIdle={0.38}
                      />
                    ) : (
                      <>
                        <circle cx={cx} cy={cy} r={2.4} className={padShape(on)} />
                        <text
                          x={cx}
                          y={cy + 0.9}
                          textAnchor="middle"
                          className={`pointer-events-none text-[2.6px] font-bold ${padText(on)}`}>
                          {label}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
            </g>

            <text x={iconGeom.stickL[0]} y={62.5} textAnchor="middle" className="fill-primary text-[2.2px] font-medium">
              {isActive(set, "LeftThumb") ? "L3" : ""}
            </text>
            <text x={iconGeom.stickR[0]} y={62.5} textAnchor="middle" className="fill-primary text-[2.2px] font-medium">
              {isActive(set, "RightThumb") ? "R3" : ""}
            </text>
          </g>
        ) : (
          <>
            <rect
              x="28"
              y="44"
              width="364"
              height="128"
              rx="52"
              ry="52"
              className="fill-default-100/85 stroke-default-300/80 dark:fill-default-50/10 dark:stroke-default-200/45"
              strokeWidth="1.5"
              filter="url(#gamepad-soft-shadow)"
            />

            <g aria-hidden>
              <g>
                <title>Hombrera izquierda (LB / L1 / L)</title>
                {leftBumperHref ? (
                  <KenneySvgImage
                    href={leftBumperHref}
                    cx={gumLx + gumLw / 2}
                    cy={legacyBumperCyL}
                    w={legacyBumperSide}
                    h={legacyBumperSide}
                    active={bumperOn("left")}
                    opacityIdle={0.34}
                    pinBottom
                  />
                ) : (
                  <rect
                    x={gumLx}
                    y={gumLy}
                    width={gumLw}
                    height={gumLh}
                    rx={6}
                    className={padShape(bumperOn("left"))}
                  />
                )}
              </g>
              <g>
                <title>Hombrera derecha (RB / R1 / R)</title>
                {rightBumperHref ? (
                  <KenneySvgImage
                    href={rightBumperHref}
                    cx={gumRx + gumRw / 2}
                    cy={legacyBumperCyR}
                    w={legacyBumperSide}
                    h={legacyBumperSide}
                    active={bumperOn("right")}
                    opacityIdle={0.34}
                    pinBottom
                  />
                ) : (
                  <rect
                    x={gumRx}
                    y={gumRy}
                    width={gumRw}
                    height={gumRh}
                    rx={6}
                    className={padShape(bumperOn("right"))}
                  />
                )}
              </g>
            </g>

            <g aria-hidden>
              <KenneyAnalogTriggerMeter
                href={leftTriggerHref}
                cx={legacyLtCx}
                cy={legacyTrigCy}
                w={28}
                h={legacyTrigH}
                value={lz}
                clipId={`${triggerClipBase}-llt`}
              />
              <KenneyAnalogTriggerMeter
                href={rightTriggerHref}
                cx={legacyRtCx}
                cy={legacyTrigCy}
                w={28}
                h={legacyTrigH}
                value={rz}
                clipId={`${triggerClipBase}-lrt`}
              />
            </g>

            <g transform={`translate(${geom.dpad[0]},${geom.dpad[1]})`} aria-hidden>
              <circle
                r="10"
                className="fill-default-200/35 stroke-default-300/50 dark:fill-default-800/25 dark:stroke-default-600/40"
                strokeWidth="1"
              />
              {(
                [
                  ["up", 0, -22],
                  ["down", 0, 22],
                  ["left", -22, 0],
                  ["right", 22, 0],
                ] as const
              ).map(([dir, ox, oy]) => {
                const ddir = dir as DpadDir;
                const href = getKenneyGamepadAssetUrl(layoutKind, kenneyDpadAssetId(layoutKind, ddir));
                const on = d[ddir];
                return (
                  <g key={dir} transform={`translate(${ox},${oy})`}>
                    <KenneySvgImage href={href} cx={0} cy={0} w={24} h={24} active={on} opacityIdle={0.32} />
                  </g>
                );
              })}
            </g>

            <g transform={`translate(${geom.stickL[0]}, ${geom.stickL[1]})`}>
              <KenneySvgImage
                href={isActive(set, "LeftThumb") ? leftStickPress : leftStickDecal}
                cx={0}
                cy={0}
                w={62}
                h={62}
                active={Math.hypot(lx, ly) > STICK_DEADZONE || isActive(set, "LeftThumb")}
                opacityIdle={0.28}
              />
              <circle r="34" className="fill-none stroke-default-400/75 dark:stroke-default-500/55" strokeWidth="2" />
              <circle
                r="14"
                className="fill-primary/90 stroke-primary-800 stroke-[1.1px] dark:stroke-primary-200"
                transform={`translate(${leftNubOuter.x}, ${leftNubOuter.y})`}
              />
              <text x="0" y="52" textAnchor="middle" className="fill-default-500 text-[9px]">
                Stick izq.
              </text>
            </g>

            <g transform={`translate(${geom.stickR[0]}, ${geom.stickR[1]})`}>
              <KenneySvgImage
                href={isActive(set, "RightThumb") ? rightStickPress : rightStickDecal}
                cx={0}
                cy={0}
                w={62}
                h={62}
                active={Math.hypot(rx, ry) > STICK_DEADZONE || isActive(set, "RightThumb")}
                opacityIdle={0.28}
              />
              <circle r="34" className="fill-none stroke-default-400/75 dark:stroke-default-500/55" strokeWidth="2" />
              <circle
                r="14"
                className="fill-primary/90 stroke-primary-800 stroke-[1.1px] dark:stroke-primary-200"
                transform={`translate(${rightNubOuter.x}, ${rightNubOuter.y})`}
              />
              <text x="0" y="52" textAnchor="middle" className="fill-default-500 text-[9px]">
                Stick der.
              </text>
            </g>

            {selectHref ? (
              <KenneySvgImage
                href={selectHref}
                cx={geom.select[0]}
                cy={geom.select[1]}
                w={28}
                h={28}
                active={isActive(set, "Select")}
                opacityIdle={0.4}
              />
            ) : (
              <>
                <ellipse
                  cx={geom.select[0]}
                  cy={geom.select[1]}
                  rx="22"
                  ry="10"
                  className={padShape(isActive(set, "Select"))}
                />
                <text
                  x={geom.select[0]}
                  y={geom.select[1] + 4}
                  textAnchor="middle"
                  className={`pointer-events-none text-[8px] font-medium ${padText(isActive(set, "Select"))}`}>
                  Sel.
                </text>
              </>
            )}

            {startHref ? (
              <KenneySvgImage
                href={startHref}
                cx={geom.start[0]}
                cy={geom.start[1]}
                w={28}
                h={28}
                active={isActive(set, "Start")}
                opacityIdle={0.4}
              />
            ) : (
              <>
                <ellipse
                  cx={geom.start[0]}
                  cy={geom.start[1]}
                  rx="22"
                  ry="10"
                  className={padShape(isActive(set, "Start"))}
                />
                <text
                  x={geom.start[0]}
                  y={geom.start[1] + 4}
                  textAnchor="middle"
                  className={`pointer-events-none text-[8px] font-medium ${padText(isActive(set, "Start"))}`}>
                  Start
                </text>
              </>
            )}

            {modeHref ? (
              <KenneySvgImage
                href={modeHref}
                cx={geom.mode[0]}
                cy={geom.mode[1]}
                w={30}
                h={30}
                active={isActive(set, "Mode")}
                opacityIdle={0.4}
              />
            ) : (
              <>
                <circle cx={geom.mode[0]} cy={geom.mode[1]} r="12" className={padShape(isActive(set, "Mode"))} />
                <text
                  x={geom.mode[0]}
                  y={geom.mode[1] + 4}
                  textAnchor="middle"
                  className={`pointer-events-none text-[9px] font-semibold ${padText(isActive(set, "Mode"))}`}>
                  ⧉
                </text>
              </>
            )}

            <g style={{ fontFamily: "system-ui, sans-serif" }}>
              {(["North", "West", "East", "South"] as const).map((key) => {
                const faceKey = key as FaceButtonKey;
                const [cx, cy] = geom.face[faceKey];
                const href = getKenneyGamepadAssetUrl(layoutKind, kenneyFaceAssetId(layoutKind, faceKey));
                const on = isActive(set, faceKey);
                const label = face[faceKey.toLowerCase() as "north" | "south" | "east" | "west"];
                return (
                  <g key={key}>
                    <title>{label}</title>
                    {href ? (
                      <KenneySvgImage href={href} cx={cx} cy={cy} w={38} h={38} active={on} opacityIdle={0.36} />
                    ) : (
                      <>
                        <circle cx={cx} cy={cy} r="18" className={padShape(on)} />
                        <text
                          x={cx}
                          y={cy + 6}
                          textAnchor="middle"
                          className={`pointer-events-none text-[13px] font-bold ${padText(on)}`}>
                          {label}
                        </text>
                      </>
                    )}
                  </g>
                );
              })}
            </g>

            <text x={geom.stickL[0]} y="188" textAnchor="middle" className="fill-primary text-[9px] font-medium">
              {isActive(set, "LeftThumb") ? "L3" : ""}
            </text>
            <text x={geom.stickR[0]} y="188" textAnchor="middle" className="fill-primary text-[9px] font-medium">
              {isActive(set, "RightThumb") ? "R3" : ""}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
