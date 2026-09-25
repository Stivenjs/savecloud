import { Button, Input } from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useQuery } from "@tanstack/react-query";
import { ImagePlus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { readImageAsDataUrl, searchSteamGames } from "@services/tauri";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import type { ManifestSearchResult } from "@services/tauri";
import type { GameFormState } from "@/hooks/useGameForm";

interface MediaTabProps {
  form: GameFormState;
  setField: <K extends keyof GameFormState>(key: K, value: GameFormState[K]) => void;
  setError: (error: string | null) => void;
  isOpen: boolean;
}

export function GameDrawerMediaTab({ form, setField, setError, isOpen }: MediaTabProps) {
  const { t } = useTranslation();
  const localImageSelected = t("library.gameDrawerMedia.localImageSelected");

  const handleSelectLocalImage = async () => {
    setError(null);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: t("library.gameDrawerMedia.pickCoverTitle"),
        filters: [
          { name: t("library.gameDrawerMedia.imageFilter"), extensions: ["jpg", "jpeg", "png", "gif", "webp"] },
        ],
      });
      if (selected && typeof selected === "string") {
        const dataUrl = await readImageAsDataUrl(selected);
        setField("imageUrl", dataUrl);
        setField("selectedSteamAppId", null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const debouncedSearch = useDebouncedValue(form.searchInput.trim(), 400);

  const { data: steamResults = [], isLoading: steamLoading } = useQuery({
    queryKey: ["steam-search", debouncedSearch],
    queryFn: () => searchSteamGames(debouncedSearch),
    enabled: debouncedSearch.length >= 3 && isOpen,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-default-500">
          {t("library.gameDrawerMedia.customCoverTitle")}{" "}
          <span className="font-normal">{t("library.gameDrawerMedia.customCoverOptional")}</span>
        </p>
        <Input
          label={t("library.gameDrawerMedia.imageUrlLabel")}
          placeholder={t("library.gameDrawerMedia.imageUrlPlaceholder")}
          value={form.imageUrl.startsWith("data:") ? localImageSelected : form.imageUrl}
          onValueChange={(v) => {
            if (v !== localImageSelected) setField("imageUrl", v);
          }}
          variant="bordered"
          endContent={
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              aria-label={t("library.gameDrawerMedia.pickLocalImage")}
              onPress={handleSelectLocalImage}>
              <ImagePlus size={18} />
            </Button>
          }
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-default-500">
          {t("library.gameDrawerMedia.steamLinkTitleReal")}{" "}
          <span className="font-normal">{t("library.gameDrawerMedia.steamLinkOptional")}</span>
        </p>
        <Input
          label={t("library.gameDrawerMedia.steamSearchLabel")}
          placeholder={t("library.gameDrawerMedia.steamSearchPlaceholder")}
          value={form.searchInput}
          onValueChange={(value) => {
            setField("searchInput", value);
            setField("selectedSteamAppId", null);
          }}
          variant="bordered"
          startContent={<Search size={16} className="text-default-400" />}
        />
        {debouncedSearch.length >= 3 && (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-medium border border-default-200 bg-default-50 px-2 py-1 text-xs">
            {steamLoading ? (
              <p className="px-1 py-1 text-default-500">{t("library.gameDrawerMedia.steamSearching")}</p>
            ) : steamResults.length === 0 ? (
              <p className="px-1 py-1 text-default-500">{t("library.gameDrawerMedia.steamNoResults")}</p>
            ) : (
              steamResults.map((r: ManifestSearchResult) => (
                <button
                  key={r.steamAppId}
                  type="button"
                  onClick={() => {
                    const nextSelected = r.steamAppId === form.selectedSteamAppId ? null : r.steamAppId;
                    setField("selectedSteamAppId", nextSelected);
                    setField("searchInput", r.name);
                    if (nextSelected && !form.gameId.trim()) {
                      const slug =
                        r.name
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, "")
                          .slice(0, 80) || "game";
                      setField("gameId", slug);
                    }
                  }}
                  className={`sg-animate-fade-in-up flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-default-100 ${
                    form.selectedSteamAppId === r.steamAppId ? "bg-primary-50 text-primary-600" : "text-default-600"
                  }`}>
                  <span className="truncate">{r.name}</span>
                  <span className="ml-2 text-[10px] text-default-400">#{r.steamAppId}</span>
                </button>
              ))
            )}
          </div>
        )}
        {form.selectedSteamAppId && (
          <p className="text-[11px] text-success">
            {t("library.gameDrawerMedia.steamSelected", { appId: form.selectedSteamAppId })}
          </p>
        )}
      </div>
    </div>
  );
}
