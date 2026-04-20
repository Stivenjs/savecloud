import { Button, Input } from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import type { GameFormState } from "@/hooks/useGameForm";
import { usePathValidation } from "@/hooks/usePathValidation";
import { formatBytes } from "@/utils/format";

interface GeneralTabProps {
  form: GameFormState;
  setField: <K extends keyof GameFormState>(key: K, value: GameFormState[K]) => void;
  setError: (error: string | null) => void;
  error: string | null;
  mode: "add" | "edit";
}

export function GameDrawerGeneralTab({ form, setField, setError, error, mode }: GeneralTabProps) {
  const handleBrowseFolder = async () => {
    setError(null);
    try {
      const selected = await open({ directory: true, multiple: false, title: "Seleccionar carpeta de guardados" });
      if (selected && typeof selected === "string") {
        setField("path", selected);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const { isValidating, result } = usePathValidation(form.path);

  const getPathDescription = () => {
    if (!form.path.trim()) return "Selecciona o escribe la ruta donde se guardan las partidas";
    if (isValidating)
      return (
        <span className="flex items-center gap-1.5 text-default-500">
          <Loader2 size={14} className="animate-spin" /> Verificando ruta...
        </span>
      );
    if (result) {
      if (result.exists) {
        const sizeInfo = result.sizeBytes ? ` (${formatBytes(result.sizeBytes)})` : "";
        return (
          <span className="flex items-center gap-1.5 text-success">
            <CheckCircle2 size={14} /> Directorio encontrado{sizeInfo}
          </span>
        );
      }
      return (
        <span className="flex items-center gap-1.5 text-danger">
          <AlertTriangle size={14} /> No se encontró nada en este directorio
        </span>
      );
    }
    return "Selecciona o escribe la ruta donde se guardan las partidas";
  };

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Nombre del juego"
        placeholder="ej. Elden Ring"
        value={form.gameId}
        onValueChange={(v) => setField("gameId", v)}
        description={
          mode === "add"
            ? "El nombre del juego para identificarlo en la biblioteca"
            : "Al cambiarlo se actualiza también en la nube"
        }
        variant="bordered"
        autoFocus
      />
      <Input
        label="Ruta de la carpeta de guardados (opcional)"
        placeholder="Selecciona una carpeta o escribe la ruta"
        value={form.path}
        onValueChange={(v) => setField("path", v)}
        variant="bordered"
        isInvalid={!!error || result?.exists === false}
        errorMessage={error}
        description={getPathDescription()}
        endContent={
          <Button isIconOnly variant="flat" size="sm" aria-label="Seleccionar carpeta" onPress={handleBrowseFolder}>
            <FolderOpen size={18} />
          </Button>
        }
      />
      <Input
        label="Origen / edición (opcional)"
        placeholder="ej. Steam, Empress, RUNE"
        value={form.editionLabel}
        onValueChange={(v) => setField("editionLabel", v)}
        description="Solo informativo, para recordar qué build/crack corresponde."
        variant="bordered"
      />
      <Input
        label="URL de descarga (opcional)"
        placeholder="Pega el enlace de donde descargaste esta edición"
        value={form.sourceUrl}
        onValueChange={(v) => setField("sourceUrl", v)}
        variant="bordered"
        type="url"
      />
    </div>
  );
}
