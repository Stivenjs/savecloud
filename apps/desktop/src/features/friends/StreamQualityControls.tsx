import { Select, SelectItem } from "@heroui/react";

export type StreamResolutionPreset = "720p" | "1080p" | "1440p";
export type StreamFpsPreset = 30 | 60;

interface StreamQualityControlsProps {
  resolution: StreamResolutionPreset;
  fps: StreamFpsPreset;
  onResolutionChange: (resolution: StreamResolutionPreset) => void;
  onFpsChange: (fps: StreamFpsPreset) => void;
  disabled?: boolean;
}

export function StreamQualityControls({
  resolution,
  fps,
  onResolutionChange,
  onFpsChange,
  disabled = false,
}: StreamQualityControlsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border border-default-200/70 bg-default-50/30 p-2">
      <Select
        label="Resolucion"
        labelPlacement="outside"
        size="sm"
        isDisabled={disabled}
        selectedKeys={[resolution]}
        className="text-xs"
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0];
          if (value === "720p" || value === "1080p" || value === "1440p") {
            onResolutionChange(value);
          }
        }}>
        <SelectItem key="720p" textValue="720p">
          720p
        </SelectItem>
        <SelectItem key="1080p" textValue="1080p">
          1080p
        </SelectItem>
        <SelectItem key="1440p" textValue="1440p">
          1440p
        </SelectItem>
      </Select>

      <Select
        label="FPS"
        labelPlacement="outside"
        size="sm"
        isDisabled={disabled}
        selectedKeys={[String(fps)]}
        className="text-xs"
        onSelectionChange={(keys) => {
          const value = Number(Array.from(keys)[0]);
          if (value === 30 || value === 60) {
            onFpsChange(value);
          }
        }}>
        <SelectItem key="30" textValue="30 FPS">
          30 FPS
        </SelectItem>
        <SelectItem key="60" textValue="60 FPS">
          60 FPS
        </SelectItem>
      </Select>
    </div>
  );
}
