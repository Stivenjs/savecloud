import { Button, Input } from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import type { GameFormState } from "@/hooks/useGameForm";

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

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Identificador del juego"
        placeholder="ej. elden-ring"
        value={form.gameId}
        onValueChange={(v) => setField("gameId", v)}
        description={
          mode === "add"
            ? "Un nombre único para identificar el juego (minúsculas, guiones)"
            : "Al cambiarlo se actualiza también en la nube"
        }
        variant="bordered"
        autoFocus
      />
      <Input
        label="Ruta de la carpeta de guardados"
        placeholder="Selecciona una carpeta o escribe la ruta"
        value={form.path}
        onValueChange={(v) => setField("path", v)}
        variant="bordered"
        isInvalid={!!error}
        errorMessage={error}
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
