import { useCallback, useState } from "react";
import { Button, Input } from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, CheckCircle2, AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GameFormState } from "@/hooks/useGameForm";
import { usePathValidation } from "@/hooks/usePathValidation";
import { formatBytes } from "@/utils/format";
import { dedupePreserveGamePaths } from "@utils/gameSavePaths";

interface GeneralTabProps {
  form: GameFormState;
  setField: <K extends keyof GameFormState>(key: K, value: GameFormState[K]) => void;
  setError: (error: string | null) => void;
  error: string | null;
  mode: "add" | "edit";
}

function SavePathRow({
  pathValue,
  onChange,
  onRemove,
}: {
  pathValue: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { isValidating, result } = usePathValidation(pathValue);

  const status = (() => {
    if (!pathValue.trim())
      return <span className="text-[11px] text-default-400">{t("library.gameDrawerGeneral.emptyPathHint")}</span>;
    if (isValidating)
      return (
        <span className="flex items-center gap-1 text-[11px] text-default-500">
          <Loader2 size={12} className="animate-spin" /> {t("library.gameDrawerGeneral.verifying")}
        </span>
      );
    if (result) {
      if (result.exists) {
        const sizeInfo = result.sizeBytes ? ` · ${formatBytes(result.sizeBytes)}` : "";
        return (
          <span className="flex items-center gap-1 text-[11px] text-success">
            <CheckCircle2 size={12} /> {t("library.gameDrawerGeneral.pathFound", { sizeInfo })}
          </span>
        );
      }
      return (
        <span className="flex items-center gap-1 text-[11px] text-danger">
          <AlertTriangle size={12} /> {t("library.gameDrawerGeneral.pathNotFoundOnDevice")}
        </span>
      );
    }
    return null;
  })();

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-default-200 bg-default-50/40 px-3 py-2.5 dark:border-default-100/15 dark:bg-default-100/10">
      <div className="flex gap-2">
        <Input
          className="flex-1 min-w-0"
          aria-label={t("library.gameDrawerGeneral.savePathAria")}
          placeholder={t("library.gameDrawerGeneral.pathPlaceholder")}
          value={pathValue}
          onValueChange={onChange}
          size="sm"
          variant="bordered"
          isInvalid={result?.exists === false && pathValue.trim() !== "" && !isValidating}
        />
        <Button
          isIconOnly
          size="sm"
          variant="light"
          className="shrink-0 text-danger"
          aria-label={t("library.gameDrawerGeneral.removePath")}
          onPress={onRemove}>
          <Trash2 size={16} />
        </Button>
      </div>
      {status && <div className="text-default-600">{status}</div>}
    </div>
  );
}

export function GameDrawerGeneralTab({ form, setField, setError, error, mode }: GeneralTabProps) {
  const { t } = useTranslation();
  const [manualDraft, setManualDraft] = useState("");

  const mergePathsFromPicker = useCallback(
    (picked: readonly string[]) => {
      setError(null);
      setField("paths", dedupePreserveGamePaths([...form.paths, ...picked]));
    },
    [form.paths, setField, setError]
  );

  const handleBrowseFolders = async () => {
    setError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: t("library.gameDrawerGeneral.pickFoldersTitle"),
      });
      const list =
        selected == null ? [] : Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
      mergePathsFromPicker(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const appendManualDraft = () => {
    const trimmed = manualDraft.trim();
    setError(null);
    if (!trimmed) return;
    mergePathsFromPicker([trimmed]);
    setManualDraft("");
  };

  return (
    <div className="flex flex-col gap-4">
      <Input
        label={t("library.gameDrawerGeneral.gameNameLabel")}
        placeholder={t("library.gameDrawerGeneral.gameNamePlaceholder")}
        value={form.gameId}
        onValueChange={(v) => setField("gameId", v)}
        description={
          mode === "add"
            ? t("library.gameDrawerGeneral.gameNameDescAdd")
            : t("library.gameDrawerGeneral.gameNameDescEdit")
        }
        variant="bordered"
        autoFocus
      />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t("library.gameDrawerGeneral.savePathsTitle")}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-default-400">
              {t("library.gameDrawerGeneral.savePathsDescLong")}
            </p>
          </div>
          <Button
            size="sm"
            variant="flat"
            color="primary"
            startContent={<FolderOpen size={16} />}
            onPress={() => void handleBrowseFolders()}>
            {t("library.gameDrawerGeneral.addFolders")}
          </Button>
        </div>

        {form.paths.length === 0 ? (
          <p className="rounded-lg border border-dashed border-default-300 px-3 py-3 text-xs text-default-500 dark:border-default-100/25">
            {t("library.gameDrawerGeneral.noPathsYetLong")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {form.paths.map((p, i) => (
              <SavePathRow
                key={`${p}:${i}`}
                pathValue={p}
                onChange={(v) => {
                  const next = [...form.paths];
                  next[i] = v;
                  setField("paths", next);
                }}
                onRemove={() => {
                  setField(
                    "paths",
                    form.paths.filter((_, idx) => idx !== i)
                  );
                }}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Input
            className="min-w-48 flex-1"
            label={t("library.gameDrawerGeneral.manualPathLabel")}
            placeholder={t("library.gameDrawerGeneral.manualPathPlaceholder")}
            value={manualDraft}
            size="sm"
            variant="bordered"
            onValueChange={setManualDraft}
            endContent={
              <Button
                size="sm"
                isIconOnly
                variant="light"
                aria-label={t("library.gameDrawerGeneral.addWrittenPath")}
                onPress={appendManualDraft}>
                <Plus size={18} />
              </Button>
            }
            errorMessage={error}
            isInvalid={!!error}
          />
        </div>
      </div>

      <Input
        label={t("library.gameDrawerGeneral.editionLabel")}
        placeholder={t("library.gameDrawerGeneral.editionPlaceholder")}
        value={form.editionLabel}
        onValueChange={(v) => setField("editionLabel", v)}
        description={t("library.gameDrawerGeneral.editionDesc")}
        variant="bordered"
      />
      <Input
        label={t("library.gameDrawerGeneral.sourceUrlLabel")}
        placeholder={t("library.gameDrawerGeneral.sourceUrlPlaceholder")}
        value={form.sourceUrl}
        onValueChange={(v) => setField("sourceUrl", v)}
        variant="bordered"
        type="url"
      />
    </div>
  );
}
