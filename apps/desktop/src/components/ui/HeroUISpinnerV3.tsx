import React, { useId } from "react";

/**
 * Propiedades para el componente Spinner de HeroUI v3.
 */
export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Variante de tamaño del spinner. @default "md" */
  size?: "sm" | "md" | "lg";

  /** Variante del tema de color del spinner. @default "primary" */
  color?: "current" | "white" | "default" | "primary" | "secondary" | "success" | "warning" | "danger";

  /** Etiqueta de texto opcional o elementos React personalizados mostrados junto al spinner. */
  label?: React.ReactNode;

  /** Variante de color para la etiqueta de texto. @default "default" */
  labelColor?: "foreground" | "primary" | "secondary" | "success" | "warning" | "danger" | "default";

  /** Clases CSS adicionales para aplicar al contenedor raíz. */
  className?: string;

  /** Nombres de clases basados en slots para compatibilidad con la API de slots de HeroUI v2. */
  classNames?: {
    base?: string;
    wrapper?: string;
    circle1?: string;
    circle2?: string;
    label?: string;
  };

  /** Etiqueta de accesibilidad para lectores de pantalla. Por defecto usa el texto de label o "Cargando". */
  "aria-label"?: string;
}

/**
 * Función auxiliar para combinar clases CSS condicionales limpiamente.
 *
 * @param inputs - Lista de clases condicionales o valores falsy.
 * @returns Cadena de texto con las clases concatenadas.
 */
function cn(...inputs: (string | boolean | undefined | null)[]): string {
  return inputs.filter(Boolean).join(" ");
}

/** Mapeo de nombres de color a utilidades de color de texto en Tailwind CSS. */
const COLOR_CLASSES: Record<string, string> = {
  current: "text-current",
  white: "text-white",
  default: "text-default-500 text-[var(--heroui-default-500,#a1a1aa)]",
  primary: "text-primary text-[var(--heroui-primary,#006fee)]",
  secondary: "text-secondary text-[var(--heroui-secondary,#9353d3)]",
  success: "text-success text-[var(--heroui-success,#17c964)]",
  warning: "text-warning text-[var(--heroui-warning,#f5a524)]",
  danger: "text-danger text-[var(--heroui-danger,#f31260)]",
};

/** Mapeo de variantes de tamaño a dimensiones de Tailwind CSS. */
const SIZE_CLASSES: Record<string, string> = {
  sm: "w-4 h-4",
  md: "w-7 h-7",
  lg: "w-10 h-10",
};

/**
 * Componente Spinner de HeroUI v3.
 *
 * Renderiza un indicador de carga SVG giratorio con gradientes lineales duales inspirado en los estándares de diseño de HeroUI v3.
 * Soporta todas las propiedades estándar de HeroUI, incluyendo tamaño, color, etiqueta y classNames por slot.
 */
export const HeroUISpinnerV3 = React.forwardRef<HTMLDivElement, SpinnerProps>(
  (
    {
      size = "md",
      color = "primary",
      label,
      labelColor = "default",
      className,
      classNames,
      "aria-label": ariaLabel,
      ...props
    },
    ref
  ) => {
    const id = useId();
    const computedAriaLabel = ariaLabel || (typeof label === "string" ? label : "Cargando");

    const colorClass = COLOR_CLASSES[color] || COLOR_CLASSES.primary;
    const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;

    return (
      <div
        ref={ref}
        role="status"
        aria-label={computedAriaLabel}
        className={cn(
          "inline-flex flex-col items-center justify-center gap-2",
          classNames?.base,
          classNames?.wrapper,
          className
        )}
        {...props}>
        <svg
          data-slot="spinner-icon"
          viewBox="0 0 24 24"
          className={cn("animate-spin shrink-0", sizeClass, colorClass, classNames?.circle1)}
          aria-hidden="true">
          <defs>
            <linearGradient id={`heroui-v3-spinner-grad1-${id}`} x1="50%" x2="50%" y1="5.271%" y2="91.793%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={1} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.55} />
            </linearGradient>
            <linearGradient id={`heroui-v3-spinner-grad2-${id}`} x1="50%" x2="50%" y1="15.24%" y2="87.15%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <g fill="none">
            <path d="m12.593 23.258l-.011.002l-.071.035l-.02.004l-.014-.004l-.071-.035q-.016-.005-.024.005l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.017-.018m.265-.113l-.013.002l-.185.093l-.01.01l-.003.011l.018.43l.005.012l.008.007l.201.093q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.004-.011l.017-.43l-.003-.012l-.01-.01z" />
            <path
              d="M8.749.021a1.5 1.5 0 0 1 .497 2.958A7.5 7.5 0 0 0 3 10.375a7.5 7.5 0 0 0 7.5 7.5v3c-5.799 0-10.5-4.7-10.5-10.5C0 5.23 3.726.865 8.749.021"
              fill={`url(#heroui-v3-spinner-grad1-${id})`}
              transform="translate(1.5 1.625)"
            />
            <path
              d="M15.392 2.673a1.5 1.5 0 0 1 2.119-.115A10.48 10.48 0 0 1 21 10.375c0 5.8-4.701 10.5-10.5 10.5v-3a7.5 7.5 0 0 0 5.007-13.084a1.5 1.5 0 0 1-.115-2.118"
              fill={`url(#heroui-v3-spinner-grad2-${id})`}
              transform="translate(1.5 1.625)"
            />
          </g>
        </svg>
        {label && (
          <span className={cn("text-xs font-medium text-muted-foreground opacity-80", classNames?.label)}>{label}</span>
        )}
      </div>
    );
  }
);

HeroUISpinnerV3.displayName = "HeroUISpinnerV3";
