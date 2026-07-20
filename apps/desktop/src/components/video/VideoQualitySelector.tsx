import { useMemo } from "react";
import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from "@heroui/react";
import { Settings } from "lucide-react";

export interface QualityOption {
  readonly index: number;
  readonly label: string;
}

export interface VideoQualitySelectorProps {
  readonly qualities: readonly QualityOption[];
  readonly currentQuality: number;
  readonly onSelectQuality: (index: number) => void;
  readonly className?: string;
  readonly placement?: "top-end" | "bottom-end" | "top-start" | "bottom-start" | "bottom" | "top";
  readonly buttonSize?: "sm" | "md";
}

/**
 * Componente reutilizable para la selección de calidad de vídeo (HLS).
 * Proporciona un menú desplegable elegante utilizando componentes de HeroUI.
 */
export function VideoQualitySelector({
  qualities,
  currentQuality,
  onSelectQuality,
  className = "",
  placement = "top-end",
  buttonSize = "sm",
}: VideoQualitySelectorProps) {
  const qualityOptions = useMemo((): QualityOption[] => [{ index: -1, label: "Auto" }, ...qualities], [qualities]);

  const activeLabel = useMemo(() => {
    if (currentQuality === -1) return "Auto";
    return qualities.find((q) => q.index === currentQuality)?.label ?? "Auto";
  }, [currentQuality, qualities]);

  const buttonClass =
    buttonSize === "sm"
      ? "h-7 min-w-16 px-2 rounded bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 text-[11px] gap-1 font-semibold border border-white/10 cursor-pointer"
      : "h-9 px-3 rounded-lg bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 text-xs gap-1 font-medium border border-white/10 cursor-pointer";

  const iconSize = buttonSize === "sm" ? 12 : 14;

  return (
    <div className={className}>
      <Dropdown placement={placement}>
        <DropdownTrigger>
          <Button size="sm" variant="flat" className={buttonClass}>
            <Settings size={iconSize} />
            {activeLabel}
          </Button>
        </DropdownTrigger>
        <DropdownMenu
          aria-label="Seleccionar Calidad"
          selectionMode="single"
          selectedKeys={new Set([currentQuality.toString()])}
          onAction={(key) => onSelectQuality(Number(key))}>
          {qualityOptions.map((q) => (
            <DropdownItem key={q.index.toString()}>{q.label}</DropdownItem>
          ))}
        </DropdownMenu>
      </Dropdown>
    </div>
  );
}
