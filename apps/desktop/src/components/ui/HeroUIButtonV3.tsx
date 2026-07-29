import React from "react";
import { Button as HeroUIButton, type ButtonProps } from "@heroui/react";
import { HeroUISpinnerV3 } from "@/components/ui/HeroUISpinnerV3";

/**
 * Componente Button adaptado a HeroUI v3.
 *
 * Extiende el `Button` estándar de HeroUI para inyectar automáticamente el `HeroUISpinnerV3`
 * cuando el botón entra en estado de carga (`isLoading={true}`).
 */
export const HeroUIButtonV3 = React.forwardRef<HTMLButtonElement, ButtonProps>(({ spinner, size, ...props }, ref) => {
  const spinnerSize = size === "lg" ? "md" : "sm";
  const defaultSpinner = <HeroUISpinnerV3 size={spinnerSize} color="current" />;

  return <HeroUIButton ref={ref} size={size} spinner={spinner ?? defaultSpinner} {...props} />;
});

HeroUIButtonV3.displayName = "HeroUIButtonV3";
