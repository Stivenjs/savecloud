import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useShellUiStore } from "@store/ShellUiStore";

/** Ítem de navegación del menú. */
export interface StaggeredMenuItem {
  label: string;
  ariaLabel: string;
  link: string;
  id?: string;
  icon?: React.ReactNode;
}

/** Ítem de red social del menú. */
export interface StaggeredMenuSocialItem {
  label: string;
  link: string;
}

/**
 * Props del componente {@link StaggeredMenu}.
 */
export interface StaggeredMenuProps {
  /** Lado de la pantalla donde aparece el panel. Por defecto `"right"`. */
  position?: "left" | "right";
  /** Colores de las capas decorativas pre-panel (de atrás a delante). */
  colors?: string[];
  /** Ítems de navegación principal. */
  items?: StaggeredMenuItem[];
  /** Ítems de redes sociales. */
  socialItems?: StaggeredMenuSocialItem[];
  /** Muestra la sección de redes sociales. */
  displaySocials?: boolean;
  /** Muestra el número de ítem al hacer hover. */
  displayItemNumbering?: boolean;
  /** Clase CSS adicional para el wrapper. */
  className?: string;
  /** URL del logo. */
  logoUrl?: string;
  /** Muestra el logo en el header del panel. */
  showLogo?: boolean;
  /** Color del botón toggle en estado cerrado. */
  menuButtonColor?: string;
  /** Color del botón toggle en estado abierto. */
  openMenuButtonColor?: string;
  /** Color de acento para números y hover de socials. */
  accentColor?: string;
  /** Usa `position: fixed` para cubrir toda la ventana. */
  isFixed?: boolean;
  /** Cierra el panel al hacer clic fuera de él. */
  closeOnClickAway?: boolean;
  /** Callback cuando el menú se abre. */
  onMenuOpen?: () => void;
  /** Callback cuando el menú se cierra. */
  onMenuClose?: () => void;
  /** Callback cuando se hace clic en un ítem de navegación. */
  onItemClick?: (item: StaggeredMenuItem) => void;
  /** Nodo renderizado al final del panel, encima del footer. */
  panelFooter?: React.ReactNode;
  /**
   * Sección adicional renderizada entre la lista de ítems de navegación
   * y el footer del panel. Ideal para listas secundarias como juegos,
   * colecciones, favoritos, etc.
   */
  panelSection?: React.ReactNode;
  /** Acciones renderizadas en el header (junto al botón toggle). */
  headerActions?: React.ReactNode;
  /** Desplazamiento vertical del header en px. */
  headerOffset?: number;
  /** Cambia el color del botón al abrir. */
  changeMenuColorOnOpen?: boolean;
  /**
   * Big Picture / TV: cuando el panel está abierto, difumina el contenido detrás del menú
   * sin cambiar la paleta del panel (`--sm-panel-bg`).
   */
  bigPictureMode?: boolean;
}

const STAGGERED_MENU_STYLES = `
.sm-scope {
  --sm-panel-bg: #ffffff;
  --sm-panel-text: #111111;
  --sm-social-text: #111111;
  --sm-toggle-color: #111111;
  --sm-toggle-open-color: #111111;
}
:root.dark .sm-scope,
.dark .sm-scope,
[data-theme='dark'] .sm-scope {
  --sm-panel-bg: #111113;
  --sm-panel-text: #f4f4f5;
  --sm-social-text: #e4e4e7;
  --sm-toggle-color: #e9e9ef;
  --sm-toggle-open-color: #e9e9ef;
}
.sm-scope .staggered-menu-wrapper { position: relative; width: 100%; height: 100%; z-index: 40; pointer-events: none; }
.sm-scope .staggered-menu-header { position: absolute; top: 0; left: 0; width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 1rem; background: transparent; pointer-events: none; z-index: 20; }
.sm-scope .staggered-menu-header > * { pointer-events: auto; }
.sm-scope .sm-logo { display: flex; align-items: center; user-select: none; }
.sm-scope .sm-logo-img { display: block; height: 32px; width: auto; object-fit: contain; }
.sm-scope .sm-toggle { position: relative; display: inline-flex; align-items: center; gap: 0.3rem; background: transparent; border: none; cursor: pointer; color: var(--sm-toggle-color); font-weight: 500; line-height: 1; overflow: visible; }
.sm-scope .sm-toggle:focus-visible { outline: 2px solid #ffffffaa; outline-offset: 4px; border-radius: 4px; }
.sm-scope .sm-header-controls { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.45rem; border-radius: 9999px; background: color-mix(in oklab, var(--heroui-background, #fff) 86%, transparent); border: 1px solid color-mix(in oklab, var(--heroui-default-300, #d4d4d8) 68%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 6px 20px rgba(0,0,0,0.12); }
.sm-scope .sm-header-controls .sm-toggle { padding: 0.35rem 0.5rem; border-radius: 9999px; }
.sm-scope .sm-header-controls .sm-toggle:hover { background: color-mix(in oklab, currentColor 10%, transparent); }
.sm-scope .sm-header-controls .sm-toggle:focus-visible { outline-offset: 2px; }
:root.dark .sm-scope .sm-header-controls,
.dark .sm-scope .sm-header-controls,
[data-theme='dark'] .sm-scope .sm-header-controls { background: color-mix(in oklab, #09090b 82%, transparent); border-color: color-mix(in oklab, #52525b 58%, transparent); box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
.sm-scope .sm-line:last-of-type { margin-top: 6px; }
.sm-scope .sm-toggle-textWrap { position: relative; margin-right: 0.5em; display: inline-block; height: 1em; overflow: hidden; white-space: nowrap; width: var(--sm-toggle-width, auto); min-width: var(--sm-toggle-width, auto); }
.sm-scope .sm-toggle-textInner { display: flex; flex-direction: column; line-height: 1; }
.sm-scope .sm-toggle-line { display: block; height: 1em; line-height: 1; }
.sm-scope .sm-icon { position: relative; width: 14px; height: 14px; flex: 0 0 14px; display: inline-flex; align-items: center; justify-content: center; will-change: transform; }
.sm-scope .sm-panel-itemWrap { position: relative; overflow: hidden; line-height: 1; }
.sm-scope .sm-icon-line { position: absolute; left: 50%; top: 50%; width: 100%; height: 2px; background: currentColor; border-radius: 2px; transform: translate(-50%, -50%); will-change: transform; }
.sm-scope .sm-line { display: none !important; }
.sm-scope .staggered-menu-panel { position: absolute; top: 0; right: 0; width: clamp(280px, 32vw, 380px); height: 100%; background: var(--sm-panel-bg); color: var(--sm-panel-text); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); display: flex; flex-direction: column; padding: 2.5rem; overflow-y: auto; z-index: 10; }
.sm-scope [data-position='left'] .staggered-menu-panel { right: auto; left: 0; }
.sm-scope .sm-prelayers { position: absolute; top: 0; right: 0; bottom: 0; width: clamp(280px, 32vw, 380px); pointer-events: none; z-index: 5; }
.sm-scope [data-position='left'] .sm-prelayers { right: auto; left: 0; }
.sm-scope .sm-prelayer { position: absolute; top: 0; right: 0; height: 100%; width: 100%; transform: translateX(0); }
.sm-scope .sm-panel-inner { flex: 1; display: flex; flex-direction: column; gap: 1.25rem; }
.sm-scope .sm-socials { margin-top: auto; padding-top: 2rem; display: flex; flex-direction: column; gap: 0.75rem; }
.sm-scope .sm-socials-title { margin: 0; font-size: 1rem; font-weight: 500; color: var(--sm-accent, #ff0000); }
.sm-scope .sm-socials-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: row; align-items: center; gap: 1rem; flex-wrap: wrap; }
.sm-scope .sm-socials-list .sm-socials-link { opacity: 1; transition: opacity 0.3s ease; }

.sm-scope.sm-big-picture .sm-bp-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  transition: opacity 0.38s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.38s;
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  background-color: transparent;
  pointer-events: none;
  visibility: hidden;
  opacity: 0;
}
.sm-scope.sm-big-picture.sm-bp-panel-open .sm-bp-scrim {
  visibility: visible;
  pointer-events: auto;
  opacity: 1;
}
.sm-scope.sm-big-picture.sm-bp-panel-open .sm-prelayers { opacity: 0; pointer-events: none; visibility: hidden; }
.sm-scope.sm-big-picture .staggered-menu-panel {
  width: clamp(300px, 20vw, 420px);
  padding: clamp(2.5rem, 5vh, 3.25rem) clamp(1.25rem, 2vw, 1.75rem) clamp(1.75rem, 4vh, 2.5rem)
    clamp(1.35rem, 2.2vw, 1.85rem);
  box-sizing: border-box;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}
.sm-scope.sm-big-picture .sm-prelayers {
  width: clamp(300px, 20vw, 420px);
}
.sm-scope.sm-big-picture .sm-panel-inner {
  gap: clamp(1.35rem, 2.8vh, 1.85rem);
}
.sm-scope.sm-big-picture .sm-panel-list {
  gap: clamp(0.3rem, 0.65vh, 0.55rem);
}
.sm-scope.sm-big-picture .sm-panel-item {
  min-height: clamp(3rem, 6.75vh, 4rem);
  padding: clamp(0.65rem, 1.4vh, 1rem) clamp(1rem, 2vw, 1.25rem);
  font-size: clamp(1.05rem, min(2.1vw, 2.55vh), 1.35rem);
  font-weight: 600;
  letter-spacing: 0.02em;
  border-radius: 0.65rem;
  line-height: 1.15;
}
.sm-scope.sm-big-picture .sm-panel-item:hover,
.sm-scope.sm-big-picture .sm-panel-item:focus-visible {
  background: color-mix(in oklab, var(--sm-panel-text) 12%, transparent);
}
.sm-scope.sm-big-picture .sm-panel-itemLabel {
  gap: clamp(0.95rem, 2vw, 1.35rem);
}
.sm-scope.sm-big-picture .sm-item-icon svg {
  width: clamp(1.5rem, min(3.2vw, 3.5vh), 1.875rem);
  height: clamp(1.5rem, min(3.2vw, 3.5vh), 1.875rem);
}
.sm-scope.sm-big-picture .sm-panel-list[data-numbering] .sm-panel-item::after {
  font-size: clamp(0.8rem, min(1.6vw, 2vh), 0.95rem);
  font-weight: 600;
  right: clamp(0.85rem, 2vw, 1.15rem);
}
.sm-scope.sm-big-picture .staggered-menu-header {
  padding-left: clamp(1rem, 2.2vw, 1.5rem);
  padding-right: clamp(1rem, 2.2vw, 1.5rem);
}
.sm-scope.sm-big-picture .sm-header-controls {
  padding: 0.4rem 0.55rem;
  gap: 0.5rem;
}

@media (max-width: 1024px) {
  .sm-scope.sm-big-picture .staggered-menu-panel,
  .sm-scope.sm-big-picture .sm-prelayers {
    width: clamp(272px, 52vw, 400px);
  }
}
@media (max-width: 640px) {
  .sm-scope.sm-big-picture .staggered-menu-panel,
  .sm-scope.sm-big-picture .sm-prelayers {
    width: clamp(260px, 86vw, 100%);
  }
}
.sm-scope .sm-socials-list:hover .sm-socials-link:not(:hover) { opacity: 0.35; }
.sm-scope .sm-socials-list:focus-within .sm-socials-link:not(:focus-visible) { opacity: 0.35; }
.sm-scope .sm-socials-list .sm-socials-link:hover,
.sm-scope .sm-socials-list .sm-socials-link:focus-visible { opacity: 1; }
.sm-scope .sm-socials-link:focus-visible { outline: 2px solid var(--sm-accent, #ff0000); outline-offset: 3px; }
.sm-scope .sm-socials-link { font-size: 1.2rem; font-weight: 500; color: var(--sm-social-text); text-decoration: none; position: relative; padding: 2px 0; display: inline-block; transition: color 0.3s ease, opacity 0.3s ease; }
.sm-scope .sm-socials-link:hover { color: var(--sm-accent, #ff0000); }
.sm-scope .sm-panel-title { margin: 0; font-size: 1rem; font-weight: 600; color: var(--sm-panel-text); text-transform: uppercase; }
.sm-scope .sm-panel-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.sm-scope .sm-panel-item { position: relative; color: var(--sm-panel-text); font-weight: 500; font-size: 1rem; cursor: pointer; line-height: 1.2; letter-spacing: -0.01em; transition: background 0.2s, color 0.2s; display: flex !important; align-items: center; text-decoration: none; padding: 0.6rem 0.75rem; border-radius: 0.5rem; width: 100%; }
.sm-scope .sm-panel-itemLabel { display: flex !important; align-items: center; gap: 0.75rem; will-change: transform; transform-origin: 50% 100%; width: 100%; }
.sm-scope .sm-panel-item:hover { background: color-mix(in oklab, var(--sm-panel-text) 8%, transparent); }
.sm-scope .sm-panel-list[data-numbering] { counter-reset: smItem; }
.sm-scope .sm-panel-list[data-numbering] .sm-panel-item::after { counter-increment: smItem; content: counter(smItem, decimal-leading-zero); position: absolute; top: 50%; right: 0.75rem; transform: translateY(-50%); font-size: 0.75rem; font-weight: 400; color: var(--sm-accent, #ff0000); letter-spacing: 0; pointer-events: none; user-select: none; opacity: var(--sm-num-opacity, 0); }

.sm-scope .sm-panel-section { flex-shrink: 0; }

@media (max-width: 1024px) { .sm-scope .staggered-menu-panel { width: 100%; left: 0; right: 0; } .sm-scope .staggered-menu-wrapper[data-open] .sm-logo-img { filter: invert(100%); } }
@media (max-width: 640px) { .sm-scope .staggered-menu-panel { width: 100%; left: 0; right: 0; } .sm-scope .staggered-menu-wrapper[data-open] .sm-logo-img { filter: invert(100%); } }
`;

/**
 * Menú lateral animado con capas decorativas tipo "stagger".
 *
 * El panel se divide en tres zonas verticales:
 * 1. **Lista de navegación principal** — ítems con animación de entrada.
 * 2. **Sección adicional** (`panelSection`) — renderizada debajo de la nav;
 *    útil para listas secundarias como juegos, colecciones, etc.
 * 3. **Footer del panel** (`panelFooter`) — fijado al fondo (toggle de tema, etc.)
 *    seguido opcionalmente de la sección de redes sociales.
 *
 * Las animaciones de apertura/cierre usan GSAP y se orquestan mediante refs
 * para evitar re-renders innecesarios.
 *
 * @example
 * ```tsx
 * <StaggeredMenu
 *   isFixed
 *   position="left"
 *   items={navItems}
 *   panelSection={<MenuGamesList games={games} onGameClick={handleClick} />}
 *   panelFooter={<ThemeToggle />}
 * />
 * ```
 */
export const StaggeredMenu: React.FC<StaggeredMenuProps> = ({
  position = "right",
  colors = ["#B19EEF", "#5227FF"],
  items = [],
  socialItems = [],
  displaySocials = true,
  displayItemNumbering = true,
  className,
  logoUrl = "/src/assets/128x128.png",
  showLogo = true,
  menuButtonColor = "var(--sm-toggle-color)",
  openMenuButtonColor = "var(--sm-toggle-open-color)",
  accentColor = "#5227FF",
  isFixed = false,
  closeOnClickAway = true,
  onMenuOpen,
  onMenuClose,
  onItemClick,
  panelFooter,
  panelSection,
  headerActions,
  headerOffset = 0,
  changeMenuColorOnOpen = true,
  bigPictureMode = false,
}: StaggeredMenuProps) => {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const preLayersRef = useRef<HTMLDivElement | null>(null);
  const preLayerElsRef = useRef<HTMLElement[]>([]);

  const plusHRef = useRef<HTMLSpanElement | null>(null);
  const plusVRef = useRef<HTMLSpanElement | null>(null);
  const iconRef = useRef<HTMLSpanElement | null>(null);

  const textInnerRef = useRef<HTMLSpanElement | null>(null);
  const textWrapRef = useRef<HTMLSpanElement | null>(null);
  const [textLines, setTextLines] = useState<string[]>(["Menu", "Cerrar"]);

  const openTlRef = useRef<gsap.core.Timeline | null>(null);
  const closeTweenRef = useRef<gsap.core.Tween | null>(null);
  const spinTweenRef = useRef<gsap.core.Timeline | null>(null);
  const textCycleAnimRef = useRef<gsap.core.Tween | null>(null);
  const colorTweenRef = useRef<gsap.core.Tween | null>(null);

  const toggleBtnRef = useRef<HTMLButtonElement | null>(null);
  const busyRef = useRef(false);

  const itemEntranceTweenRef = useRef<gsap.core.Tween | null>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const panel = panelRef.current;
      const preContainer = preLayersRef.current;
      const plusH = plusHRef.current;
      const plusV = plusVRef.current;
      const icon = iconRef.current;
      const textInner = textInnerRef.current;

      if (!panel || !plusH || !plusV || !icon || !textInner) return;

      let preLayers: HTMLElement[] = [];
      if (preContainer) {
        preLayers = Array.from(preContainer.querySelectorAll(".sm-prelayer")) as HTMLElement[];
      }
      preLayerElsRef.current = preLayers;

      const offscreen = position === "left" ? -100 : 100;
      if (!openRef.current) {
        gsap.set([panel, ...preLayers], { xPercent: offscreen });
        gsap.set(plusH, { transformOrigin: "50% 50%", rotate: 0 });
        gsap.set(plusV, { transformOrigin: "50% 50%", rotate: 90 });
        gsap.set(icon, { rotate: 0, transformOrigin: "50% 50%" });
        gsap.set(textInner, { yPercent: 0 });
      }

      if (toggleBtnRef.current) gsap.set(toggleBtnRef.current, { color: menuButtonColor });
    });
    return () => ctx.revert();
  }, [menuButtonColor, position]);

  const buildOpenTimeline = useCallback(() => {
    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return null;

    openTlRef.current?.kill();
    if (closeTweenRef.current) {
      closeTweenRef.current.kill();
      closeTweenRef.current = null;
    }
    itemEntranceTweenRef.current?.kill();

    const itemEls = Array.from(panel.querySelectorAll(".sm-panel-itemLabel")) as HTMLElement[];
    const numberEls = Array.from(
      panel.querySelectorAll(".sm-panel-list[data-numbering] .sm-panel-item")
    ) as HTMLElement[];
    const socialTitle = panel.querySelector(".sm-socials-title") as HTMLElement | null;
    const socialLinks = Array.from(panel.querySelectorAll(".sm-socials-link")) as HTMLElement[];

    const layerStates = layers.map((el) => ({
      el,
      start: Number(gsap.getProperty(el, "xPercent")),
    }));
    const panelStart = Number(gsap.getProperty(panel, "xPercent"));

    if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });
    if (numberEls.length) gsap.set(numberEls, { ["--sm-num-opacity" as any]: 0 });
    if (socialTitle) gsap.set(socialTitle, { opacity: 0 });
    if (socialLinks.length) gsap.set(socialLinks, { y: 25, opacity: 0 });

    const tl = gsap.timeline({ paused: true });

    layerStates.forEach((ls, i) => {
      tl.fromTo(ls.el, { xPercent: ls.start }, { xPercent: 0, duration: 0.5, ease: "power4.out" }, i * 0.07);
    });

    const lastTime = layerStates.length ? (layerStates.length - 1) * 0.07 : 0;
    const panelInsertTime = lastTime + (layerStates.length ? 0.08 : 0);
    const panelDuration = 0.65;

    tl.fromTo(
      panel,
      { xPercent: panelStart },
      { xPercent: 0, duration: panelDuration, ease: "power4.out" },
      panelInsertTime
    );

    if (itemEls.length) {
      const itemsStart = panelInsertTime + panelDuration * 0.15;

      tl.to(
        itemEls,
        {
          yPercent: 0,
          rotate: 0,
          duration: 1,
          ease: "power4.out",
          stagger: { each: 0.1, from: "start" },
        },
        itemsStart
      );

      if (numberEls.length) {
        tl.to(
          numberEls,
          {
            duration: 0.6,
            ease: "power2.out",
            ["--sm-num-opacity" as any]: 1,
            stagger: { each: 0.08, from: "start" },
          },
          itemsStart + 0.1
        );
      }
    }

    if (socialTitle || socialLinks.length) {
      const socialsStart = panelInsertTime + panelDuration * 0.4;
      if (socialTitle) tl.to(socialTitle, { opacity: 1, duration: 0.5, ease: "power2.out" }, socialsStart);
      if (socialLinks.length) {
        tl.to(
          socialLinks,
          {
            y: 0,
            opacity: 1,
            duration: 0.55,
            ease: "power3.out",
            stagger: { each: 0.08, from: "start" },
            onComplete: () => {
              gsap.set(socialLinks, { clearProps: "opacity" });
            },
          },
          socialsStart + 0.04
        );
      }
    }

    openTlRef.current = tl;
    return tl;
  }, [position]);

  const playOpen = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const tl = buildOpenTimeline();
    if (tl) {
      tl.eventCallback("onComplete", () => {
        busyRef.current = false;
      });
      tl.play(0);
    } else {
      busyRef.current = false;
    }
  }, [buildOpenTimeline]);

  const playClose = useCallback(() => {
    openTlRef.current?.kill();
    openTlRef.current = null;
    itemEntranceTweenRef.current?.kill();

    const panel = panelRef.current;
    const layers = preLayerElsRef.current;
    if (!panel) return;

    closeTweenRef.current?.kill();
    const offscreen = position === "left" ? -100 : 100;

    closeTweenRef.current = gsap.to([...layers, panel], {
      xPercent: offscreen,
      duration: 0.32,
      ease: "power3.in",
      overwrite: "auto",
      onComplete: () => {
        const itemEls = Array.from(panel.querySelectorAll(".sm-panel-itemLabel")) as HTMLElement[];
        if (itemEls.length) gsap.set(itemEls, { yPercent: 140, rotate: 10 });

        const numberEls = Array.from(
          panel.querySelectorAll(".sm-panel-list[data-numbering] .sm-panel-item")
        ) as HTMLElement[];
        if (numberEls.length) gsap.set(numberEls, { ["--sm-num-opacity" as any]: 0 });

        const socialTitle = panel.querySelector(".sm-socials-title") as HTMLElement | null;
        const socialLinks = Array.from(panel.querySelectorAll(".sm-socials-link")) as HTMLElement[];
        if (socialTitle) gsap.set(socialTitle, { opacity: 0 });
        if (socialLinks.length) gsap.set(socialLinks, { y: 25, opacity: 0 });

        busyRef.current = false;
      },
    });
  }, [position]);

  const animateIcon = useCallback((opening: boolean) => {
    const icon = iconRef.current;
    const h = plusHRef.current;
    const v = plusVRef.current;
    if (!icon || !h || !v) return;

    spinTweenRef.current?.kill();

    if (opening) {
      gsap.set(icon, { rotate: 0, transformOrigin: "50% 50%" });
      spinTweenRef.current = gsap
        .timeline({ defaults: { ease: "power4.out" } })
        .to(h, { rotate: 45, duration: 0.5 }, 0)
        .to(v, { rotate: -45, duration: 0.5 }, 0);
    } else {
      spinTweenRef.current = gsap
        .timeline({ defaults: { ease: "power3.inOut" } })
        .to(h, { rotate: 0, duration: 0.35 }, 0)
        .to(v, { rotate: 90, duration: 0.35 }, 0)
        .to(icon, { rotate: 0, duration: 0.001 }, 0);
    }
  }, []);

  const animateColor = useCallback(
    (opening: boolean) => {
      const btn = toggleBtnRef.current;
      if (!btn) return;
      colorTweenRef.current?.kill();
      if (changeMenuColorOnOpen) {
        colorTweenRef.current = gsap.to(btn, {
          color: opening ? openMenuButtonColor : menuButtonColor,
          delay: 0.18,
          duration: 0.3,
          ease: "power2.out",
        });
      } else {
        gsap.set(btn, { color: menuButtonColor });
      }
    },
    [openMenuButtonColor, menuButtonColor, changeMenuColorOnOpen]
  );

  React.useEffect(() => {
    if (toggleBtnRef.current) {
      const target = changeMenuColorOnOpen && openRef.current ? openMenuButtonColor : menuButtonColor;
      gsap.set(toggleBtnRef.current, { color: target });
    }
  }, [changeMenuColorOnOpen, menuButtonColor, openMenuButtonColor]);

  const animateText = useCallback((opening: boolean) => {
    const inner = textInnerRef.current;
    if (!inner) return;

    textCycleAnimRef.current?.kill();

    const currentLabel = opening ? "Menu" : "Cerrar";
    const targetLabel = opening ? "Cerrar" : "Menu";
    const cycles = 3;

    const seq: string[] = [currentLabel];
    let last = currentLabel;
    for (let i = 0; i < cycles; i++) {
      last = last === "Menu" ? "Cerrar" : "Menu";
      seq.push(last);
    }
    if (last !== targetLabel) seq.push(targetLabel);
    seq.push(targetLabel);

    setTextLines(seq);
    gsap.set(inner, { yPercent: 0 });

    const lineCount = seq.length;
    const finalShift = ((lineCount - 1) / lineCount) * 100;

    textCycleAnimRef.current = gsap.to(inner, {
      yPercent: -finalShift,
      duration: 0.5 + lineCount * 0.07,
      ease: "power4.out",
    });
  }, []);

  const toggleMenu = useCallback(() => {
    const target = !openRef.current;
    openRef.current = target;
    setOpen(target);

    if (target) {
      onMenuOpen?.();
      playOpen();
    } else {
      onMenuClose?.();
      playClose();
    }

    animateIcon(target);
    animateColor(target);
    animateText(target);
  }, [playOpen, playClose, animateIcon, animateColor, animateText, onMenuOpen, onMenuClose]);

  const toggleMenuRef = useRef(toggleMenu);
  toggleMenuRef.current = toggleMenu;

  useLayoutEffect(() => {
    let last = useShellUiStore.getState().staggeredMenuToggleRequest;
    return useShellUiStore.subscribe((state) => {
      const n = state.staggeredMenuToggleRequest;
      if (n > last) {
        last = n;
        toggleMenuRef.current();
      }
    });
  }, []);

  const closeMenu = useCallback(() => {
    if (openRef.current) {
      openRef.current = false;
      setOpen(false);
      onMenuClose?.();
      playClose();
      animateIcon(false);
      animateColor(false);
      animateText(false);
    }
  }, [playClose, animateIcon, animateColor, animateText, onMenuClose]);

  const closeMenuRef = useRef(closeMenu);
  closeMenuRef.current = closeMenu;

  useLayoutEffect(() => {
    let last = useShellUiStore.getState().sideMenuCloseRequest;
    return useShellUiStore.subscribe((state) => {
      const n = state.sideMenuCloseRequest;
      if (n > last) {
        last = n;
        closeMenuRef.current();
      }
    });
  }, []);

  React.useEffect(() => {
    if (!closeOnClickAway || !open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        toggleBtnRef.current &&
        !toggleBtnRef.current.contains(event.target as Node)
      ) {
        closeMenu();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [closeOnClickAway, open, closeMenu]);

  return (
    <div
      className={`sm-scope z-40 ${bigPictureMode ? "sm-big-picture" : ""} ${
        bigPictureMode && open ? "sm-bp-panel-open" : ""
      } ${isFixed ? "pointer-events-none fixed top-0 left-0 w-screen h-screen overflow-hidden" : "w-full h-full"}`}>
      <div
        className={
          (className ? className + " " : "") + "staggered-menu-wrapper pointer-events-none relative w-full h-full z-40"
        }
        style={accentColor ? ({ ["--sm-accent" as any]: accentColor } as React.CSSProperties) : undefined}
        data-position={position}
        data-open={open || undefined}
        data-big-picture={bigPictureMode || undefined}>
        {bigPictureMode ? (
          <div
            className="sm-bp-scrim"
            aria-hidden="true"
            onMouseDown={(e) => {
              if (!closeOnClickAway || !openRef.current) return;
              e.preventDefault();
              closeMenu();
            }}
          />
        ) : null}

        <div
          ref={preLayersRef}
          className="sm-prelayers absolute top-0 right-0 bottom-0 pointer-events-none z-5"
          aria-hidden="true">
          {(() => {
            if (bigPictureMode) return null;
            const raw = colors && colors.length ? colors.slice(0, 4) : ["#1e1e22", "#35353c"];
            let arr = [...raw];
            if (arr.length >= 3) {
              const mid = Math.floor(arr.length / 2);
              arr.splice(mid, 1);
            }
            return arr.map((c, i) => (
              <div
                key={i}
                className="sm-prelayer absolute top-0 right-0 h-full w-full translate-x-0"
                style={{ background: c }}
              />
            ));
          })()}
        </div>

        <header
          className="staggered-menu-header absolute left-0 w-full flex items-center justify-between p-4 bg-transparent pointer-events-none z-20"
          style={{ top: `${headerOffset}px` }}
          aria-label="Main navigation header">
          {showLogo ? (
            <div className="sm-logo flex items-center select-none pointer-events-auto" aria-label="Logo">
              <img
                src={logoUrl || "/src/assets/128x128.png"}
                alt="Logo"
                className="sm-logo-img block h-8 w-auto object-contain"
                draggable={false}
                width={110}
                height={24}
              />
            </div>
          ) : (
            <div aria-hidden="true" />
          )}

          <div className="sm-header-controls flex items-center gap-2 pointer-events-auto">
            {headerActions}
            <button
              ref={toggleBtnRef}
              className="sm-toggle relative inline-flex items-center gap-[0.3rem] bg-transparent border-0 cursor-pointer font-medium leading-none overflow-visible pointer-events-auto"
              aria-label={open ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={open}
              aria-controls="staggered-menu-panel"
              onClick={toggleMenu}
              type="button">
              <span
                ref={textWrapRef}
                className="sm-toggle-textWrap relative inline-block h-[1em] overflow-hidden whitespace-nowrap"
                aria-hidden="true">
                <span ref={textInnerRef} className="sm-toggle-textInner flex flex-col leading-none">
                  {textLines.map((l, i) => (
                    <span className="sm-toggle-line block h-[1em] leading-none" key={i}>
                      {l}
                    </span>
                  ))}
                </span>
              </span>

              <span
                ref={iconRef}
                className="sm-icon relative w-3.5 h-3.5 shrink-0 inline-flex items-center justify-center will-change-transform"
                aria-hidden="true">
                <span
                  ref={plusHRef}
                  className="sm-icon-line absolute left-1/2 top-1/2 w-full h-0.5 bg-current rounded-xs -translate-x-1/2 -translate-y-1/2 will-change-transform"
                />
                <span
                  ref={plusVRef}
                  className="sm-icon-line sm-icon-line-v absolute left-1/2 top-1/2 w-full h-0.5 bg-current rounded-xs -translate-x-1/2 -translate-y-1/2 will-change-transform"
                />
              </span>
            </button>
          </div>
        </header>

        <aside
          id="staggered-menu-panel"
          ref={panelRef}
          className="staggered-menu-panel absolute top-0 right-0 h-full flex flex-col p-8 overflow-y-auto z-10 backdrop-blur-md pointer-events-auto"
          aria-hidden={!open}>
          <div className="sm-panel-inner flex-1 flex flex-col gap-5">
            <ul
              className="sm-panel-list list-none m-0 p-0 flex flex-col gap-2"
              role="list"
              data-numbering={displayItemNumbering || undefined}>
              {items && items.length ? (
                items.map((it, idx) => (
                  <li className="sm-panel-itemWrap relative overflow-hidden leading-none" key={it.id ?? it.label + idx}>
                    {onItemClick ? (
                      <button
                        type="button"
                        className="sm-panel-item border-0 bg-transparent"
                        aria-label={it.ariaLabel}
                        data-index={idx + 1}
                        onClick={() => {
                          onItemClick(it);
                          closeMenu();
                        }}>
                        <span className="sm-panel-itemLabel">
                          {it.icon && (
                            <span className="sm-item-icon opacity-90 inline-flex items-center shrink-0">{it.icon}</span>
                          )}
                          <span className="truncate">{it.label}</span>
                        </span>
                      </button>
                    ) : (
                      <a className="sm-panel-item" href={it.link} aria-label={it.ariaLabel} data-index={idx + 1}>
                        <span className="sm-panel-itemLabel">
                          {it.icon && (
                            <span className="sm-item-icon opacity-90 inline-flex items-center shrink-0">{it.icon}</span>
                          )}
                          <span className="truncate">{it.label}</span>
                        </span>
                      </a>
                    )}
                  </li>
                ))
              ) : (
                <li className="sm-panel-itemWrap relative overflow-hidden leading-none" aria-hidden="true">
                  <span className="sm-panel-item relative font-semibold text-2xl cursor-pointer">
                    <span className="sm-panel-itemLabel inline-block origin-[50%_100%] will-change-transform">
                      No items
                    </span>
                  </span>
                </li>
              )}
            </ul>

            {/*
             * Sección adicional (ej. lista de juegos)
             * Se renderiza entre la nav principal y el footer del panel.
             * No participa en las animaciones GSAP de ítems de nav para
             * no interferir con los selectores de `.sm-panel-itemLabel`.
             */}
            {panelSection && (
              <div className="sm-panel-section" aria-label="Sección adicional del menú">
                {panelSection}
              </div>
            )}

            {panelFooter && <div className="sm-panel-footer mt-auto pt-6">{panelFooter}</div>}

            {displaySocials && socialItems && socialItems.length > 0 && (
              <div className="sm-socials mt-auto pt-8 flex flex-col gap-3" aria-label="Social links">
                <h3 className="sm-socials-title m-0 text-base font-medium">Socials</h3>
                <ul
                  className="sm-socials-list list-none m-0 p-0 flex flex-row items-center gap-4 flex-wrap"
                  role="list">
                  {socialItems.map((s, i) => (
                    <li key={s.label + i} className="sm-socials-item">
                      <a
                        href={s.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="sm-socials-link text-[1.2rem] font-medium no-underline relative inline-block py-0.5 transition-[color,opacity] duration-300 ease-linear">
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>

      <style>{STAGGERED_MENU_STYLES}</style>
    </div>
  );
};

export default StaggeredMenu;
