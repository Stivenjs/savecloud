import { useMemo } from "react";
import { Button, Select, SelectItem, Skeleton } from "@heroui/react";
import { Download, HardDrive, Layers, Radio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { pickCandidate, sourceCandidateKey } from "@utils/sourceMatch";
import type { SourceBestMatch } from "@services/tauri";

export interface GameDetailSourceHubProps {
  sourceCandidates?: SourceBestMatch[];
  isMatchingPending: boolean;
  selectedSourceKey: string | null;
  onSelectSourceKey: (key: string) => void;
  onInstall: () => void;
}

export function GameDetailSourceHub({
  sourceCandidates,
  isMatchingPending,
  selectedSourceKey,
  onSelectSourceKey,
  onInstall,
}: GameDetailSourceHubProps) {
  const { t } = useTranslation();

  const chosen = useMemo(() => {
    return pickCandidate(sourceCandidates, selectedSourceKey);
  }, [sourceCandidates, selectedSourceKey]);

  if (isMatchingPending) {
    return (
      <section className="rounded-xl border border-default-200/50 bg-default-50/60 px-5 py-4 dark:border-default-100/10 dark:bg-default-50/8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Skeleton className="size-10 shrink-0 rounded-xl" />
            <div className="space-y-2 flex-1 max-w-md">
              <Skeleton className="h-3.5 w-36 rounded-md" />
              <Skeleton className="h-4 w-full max-w-sm rounded-md" />
            </div>
          </div>
          <Skeleton className="h-10 w-32 shrink-0 rounded-xl" />
        </div>
      </section>
    );
  }

  if (!sourceCandidates || sourceCandidates.length === 0 || !chosen) {
    return (
      <section className="rounded-xl border border-default-200/50 bg-default-50/40 px-5 py-3.5 dark:border-default-100/10 dark:bg-default-50/5">
        <div className="flex items-center gap-2.5 text-default-400">
          <Radio size={15} strokeWidth={1.5} className="shrink-0" />
          <span className="text-xs text-default-400">{t("library.detail.notAvailable")}</span>
        </div>
      </section>
    );
  }

  const hasMultipleSources = sourceCandidates.length > 1;

  return (
    <section className="group rounded-xl border border-default-200/60 bg-default-50/80 shadow-sm transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-default-300/60 dark:border-default-100/15 dark:bg-default-50/10 dark:hover:border-default-200/25">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
            <Download size={20} strokeWidth={1.75} />
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-primary">
                {t("library.detail.availability")}
              </span>
              <span className="text-[10px] text-default-400 font-medium">
                {sourceCandidates.length === 1
                  ? t("library.detail.sourcesAvailable_one", { count: 1, defaultValue: "1 fuente" })
                  : t("library.detail.sourcesAvailable_other", {
                      count: sourceCandidates.length,
                      defaultValue: `${sourceCandidates.length} fuentes`,
                    })}
              </span>
            </div>

            <h4 className="font-semibold text-sm text-foreground truncate max-w-xl leading-tight">
              {chosen.item_title}
            </h4>

            <div className="flex items-center gap-2.5 flex-wrap text-[11px] text-default-500 pt-0.5">
              <span className="font-semibold text-default-600 dark:text-default-300">{chosen.source_name}</span>

              {chosen.file_size && (
                <span className="flex items-center gap-1 font-mono text-[11px] text-default-500">
                  <HardDrive size={11} className="text-default-400 shrink-0" strokeWidth={1.5} />
                  {chosen.file_size}
                </span>
              )}

              {chosen.protocols && chosen.protocols.length > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-default-400 uppercase tracking-wider font-medium">
                  <Layers size={11} strokeWidth={1.5} />
                  {chosen.protocols.join(" / ")}
                </span>
              )}
            </div>
          </div>
        </div>

        <Button
          color="primary"
          variant="solid"
          size="md"
          className="font-bold h-10 px-5 shrink-0 shadow-sm shadow-primary/15 transition-transform duration-150 active:scale-[0.97]"
          startContent={<Download size={16} />}
          onPress={onInstall}>
          {chosen.file_size ? `${t("library.detail.install")} (${chosen.file_size})` : t("library.detail.install")}
        </Button>
      </div>

      {hasMultipleSources && (
        <div className="border-t border-default-200/50 px-5 py-3 dark:border-default-100/10">
          <Select
            aria-label={t("library.detail.chooseSource")}
            label={t("library.detail.chooseSource")}
            size="sm"
            variant="bordered"
            radius="lg"
            className="w-full max-w-lg"
            selectionMode="single"
            disallowEmptySelection
            classNames={{
              popoverContent: "min-w-[22rem]",
              trigger: "min-h-10",
            }}
            selectedKeys={new Set([selectedSourceKey ?? sourceCandidateKey(sourceCandidates[0])])}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next !== undefined) {
                onSelectSourceKey(String(next));
              }
            }}>
            {sourceCandidates.map((c: SourceBestMatch) => {
              const key = sourceCandidateKey(c);
              return (
                <SelectItem key={key} textValue={`${c.source_name} • ${c.file_size ?? ""}`} className="py-2">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-xs text-foreground">{c.source_name}</span>
                      {c.file_size && (
                        <span className="text-[10px] font-mono text-default-400 shrink-0">{c.file_size}</span>
                      )}
                    </div>
                    <span className="text-[11px] text-default-500 truncate">{c.item_title}</span>
                  </div>
                </SelectItem>
              );
            })}
          </Select>
        </div>
      )}
    </section>
  );
}
