import { useState } from "react";
import { Button, Card, CardBody, Input, Switch } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import { FolderOpen, Gamepad2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { CONFIG_QUERY_KEY, useConfig } from "@hooks/useConfig";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import {
  inventoryGetLocal,
  inventoryRegisterInstallFolder,
  inventoryScanAndPublish,
  inventoryUnregisterInstallFolder,
  setShareGameInventoryWithCloud,
} from "@services/tauri/inventory.service";
import { searchSteamGames, type ManifestSearchResult } from "@services/tauri/config.service";
import { toastError, toastSuccess } from "@utils/toast";
import { formatRelativeDate } from "@utils/format";
import { formatGameDisplayName } from "@utils/gameImage";

export const INVENTORY_LOCAL_QUERY_KEY = ["inventory-local"] as const;

export function GameInventorySettingsCard() {
  const queryClient = useQueryClient();
  const { config } = useConfig();
  const sharing = config?.shareGameInventoryWithCloud ?? true;

  const [showAddForm, setShowAddForm] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [selectedSteam, setSelectedSteam] = useState<ManifestSearchResult | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(searchInput.trim(), 400);

  const { data: localInventory } = useQuery({
    queryKey: INVENTORY_LOCAL_QUERY_KEY,
    queryFn: inventoryGetLocal,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: steamResults = [], isLoading: steamLoading } = useQuery({
    queryKey: ["inventory-steam-search", debouncedSearch],
    queryFn: () => searchSteamGames(debouncedSearch),
    enabled: showAddForm && debouncedSearch.length >= 3,
  });

  const shareMutation = useMutation({
    mutationFn: setShareGameInventoryWithCloud,
    onSuccess: async (_data, enabled) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: INVENTORY_LOCAL_QUERY_KEY }),
      ]);
      toastSuccess(
        enabled ? "Inventario compartido" : "Inventario privado",
        enabled
          ? "Los miembros de tu cloud pueden ver qué juegos tienes verificados."
          : "Tu inventario ya no se publica en la nube."
      );
    },
    onError: (e) => {
      toastError("No se pudo guardar", e instanceof Error ? e.message : String(e));
    },
  });

  const scanMutation = useMutation({
    mutationFn: () => inventoryScanAndPublish(true),
    onSuccess: (manifest) => {
      queryClient.setQueryData(INVENTORY_LOCAL_QUERY_KEY, { manifest });
      toastSuccess("Inventario actualizado", `${manifest.games.length} juego(s) verificado(s).`);
    },
    onError: (e) => {
      toastError("Error al escanear", e instanceof Error ? e.message : String(e));
    },
  });

  const registerMutation = useMutation({
    mutationFn: () => {
      if (!selectedSteam || !folderPath) {
        return Promise.reject(new Error("Selecciona el juego y la carpeta"));
      }
      return inventoryRegisterInstallFolder(selectedSteam.steamAppId, selectedSteam.name, folderPath);
    },
    onSuccess: (manifest) => {
      queryClient.setQueryData(INVENTORY_LOCAL_QUERY_KEY, { manifest });
      toastSuccess("Juego añadido", `${selectedSteam?.name ?? "Juego"} listo para compartir por LAN.`);
      setShowAddForm(false);
      setSearchInput("");
      setSelectedSteam(null);
      setFolderPath(null);
    },
    onError: (e) => {
      toastError("No se pudo añadir", e instanceof Error ? e.message : String(e));
    },
  });

  const [selectedKeyToDelete, setSelectedKeyToDelete] = useState<string | null>(null);

  const unregisterMutation = useMutation({
    mutationFn: (gameKey: string) => inventoryUnregisterInstallFolder(gameKey),
    onSuccess: (manifest) => {
      queryClient.setQueryData(INVENTORY_LOCAL_QUERY_KEY, { manifest });
      toastSuccess("Juego eliminado", "El juego ha sido eliminado del inventario.");
      setSelectedKeyToDelete(null);
    },
    onError: (e) => {
      toastError("No se pudo eliminar", e instanceof Error ? e.message : String(e));
      setSelectedKeyToDelete(null);
    },
  });

  const handleDelete = (gameKey: string, _displayName: string) => {
    setSelectedKeyToDelete(gameKey);
    unregisterMutation.mutate(gameKey);
  };

  const pickFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Carpeta de instalación del juego",
      });
      if (selected == null || Array.isArray(selected)) return;
      setFolderPath(selected);
    } catch (e) {
      toastError("No se pudo abrir el selector", e instanceof Error ? e.message : String(e));
    }
  };

  const verifiedGames = localInventory?.manifest?.games?.length ?? 0;
  const lastPublishedAt = localInventory?.manifest?.updatedAt ?? null;
  const canRegister = Boolean(selectedSteam && folderPath && sharing);

  return (
    <Card className="border border-default-200/80 bg-default-50/30 dark:bg-default-100/10">
      <CardBody className="gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/10">
            <Gamepad2 size={18} className="text-secondary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">Inventario de juegos en el cloud</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-default-500">
              Comparte instalaciones verificadas para que otros en tu cloud puedan traer juegos por LAN.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-default-200 bg-default-100/50 px-3 py-2.5 dark:border-default-100/15">
          <div className="min-w-0">
            <p className="text-sm font-medium text-default-700">Compartir inventario con el cloud</p>
            <p className="mt-0.5 text-xs text-default-500">Desactívalo si no quieres que otros vean tus juegos.</p>
          </div>
          <Switch
            isSelected={sharing}
            isDisabled={shareMutation.isPending}
            onValueChange={(enabled) => shareMutation.mutate(enabled)}
          />
        </div>

        {verifiedGames > 0 && localInventory?.manifest?.games && localInventory.manifest.games.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-default-400 uppercase tracking-wider">Juegos en inventario</p>
            <div className="divide-y divide-default-100 rounded-lg border border-default-200 bg-default-50/30 dark:divide-default-100/10 dark:border-default-100/10 overflow-hidden">
              <AnimatePresence initial={false}>
                {localInventory.manifest.games.map((game) => (
                  <motion.div
                    key={game.gameKey}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ type: "spring", stiffness: 160, damping: 22 }}
                    style={{ overflow: "hidden" }}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-default-100/30 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{formatGameDisplayName(game.displayName)}</p>
                      <p className="text-[10px] text-default-400 truncate">
                        {game.payloadKind === "installedFolder" ? "Añadido manualmente" : "Escaneo automático"} ·{" "}
                        {(game.totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB
                      </p>
                    </div>
                    {game.payloadKind === "installedFolder" ? (
                      <Button
                        size="sm"
                        variant="light"
                        color="danger"
                        className="h-7 w-7 min-w-0 p-0"
                        isIconOnly
                        isLoading={unregisterMutation.isPending && selectedKeyToDelete === game.gameKey}
                        onPress={() => handleDelete(game.gameKey, game.displayName)}>
                        <Trash2 size={13} className="text-danger" />
                      </Button>
                    ) : null}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-default-500">
              {verifiedGames > 0
                ? `${verifiedGames} juego(s)${lastPublishedAt ? ` · ${formatRelativeDate(lastPublishedAt)}` : ""}`
                : "Sin juegos en inventario"}
            </span>
            <div className="flex flex-wrap gap-2">
              {!showAddForm ? (
                <Button
                  size="sm"
                  variant="flat"
                  color="primary"
                  startContent={<Plus size={14} />}
                  isDisabled={!sharing}
                  onPress={() => setShowAddForm(true)}>
                  Añadir juego
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="bordered"
                className="border-default-300/70"
                startContent={<RefreshCw size={14} className={scanMutation.isPending ? "animate-spin" : ""} />}
                isDisabled={scanMutation.isPending || !sharing}
                onPress={() => scanMutation.mutate()}>
                Reescanear
              </Button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {showAddForm && (
              <motion.div
                initial={{ height: 0, opacity: 0, marginTop: 0 }}
                animate={{ height: "auto", opacity: 1, marginTop: 12 }}
                exit={{ height: 0, opacity: 0, marginTop: 0 }}
                transition={{ type: "spring", stiffness: 160, damping: 22 }}
                style={{ overflow: "hidden" }}>
                <div className="space-y-3 rounded-lg border border-default-200 bg-content1/60 px-3 py-3 dark:border-default-100/15">
                  <p className="text-xs text-default-500">
                    Busca el juego en Steam (como al añadirlo a la biblioteca) y elige la carpeta donde está instalado.
                  </p>

                  <Input
                    label="Buscar en Steam"
                    placeholder="Ej. Sons Of The Forest"
                    value={searchInput}
                    onValueChange={(value) => {
                      setSearchInput(value);
                      setSelectedSteam(null);
                    }}
                    variant="bordered"
                    size="sm"
                    startContent={<Search size={16} className="text-default-400" />}
                  />

                  {debouncedSearch.length >= 3 ? (
                    <div className="max-h-36 space-y-0.5 overflow-y-auto rounded-medium border border-default-200 bg-default-50 px-1 py-1 text-xs">
                      {steamLoading ? (
                        <p className="px-2 py-1.5 text-default-500">Buscando en Steam...</p>
                      ) : steamResults.length === 0 ? (
                        <p className="px-2 py-1.5 text-default-500">No se encontraron juegos.</p>
                      ) : (
                        steamResults.map((r) => (
                          <button
                            key={r.steamAppId}
                            type="button"
                            onClick={() => {
                              setSelectedSteam(r);
                              setSearchInput(r.name);
                            }}
                            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-default-100 ${
                              selectedSteam?.steamAppId === r.steamAppId
                                ? "bg-primary-50 text-primary-600"
                                : "text-default-600"
                            }`}>
                            <span className="truncate">{r.name}</span>
                            <span className="ml-2 shrink-0 text-[10px] text-default-400">#{r.steamAppId}</span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="bordered"
                      startContent={<FolderOpen size={14} />}
                      onPress={() => void pickFolder()}>
                      {folderPath ? "Cambiar carpeta" : "Elegir carpeta"}
                    </Button>
                    {folderPath ? (
                      <span className="min-w-0 flex-1 truncate text-xs text-default-500" title={folderPath}>
                        {folderPath}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="light"
                      onPress={() => {
                        setShowAddForm(false);
                        setSearchInput("");
                        setSelectedSteam(null);
                        setFolderPath(null);
                      }}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      color="primary"
                      isDisabled={!canRegister}
                      isLoading={registerMutation.isPending}
                      onPress={() => registerMutation.mutate()}>
                      Añadir al inventario
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </CardBody>
    </Card>
  );
}
