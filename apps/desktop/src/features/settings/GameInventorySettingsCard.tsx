import { Button, Card, CardBody, Switch } from "@heroui/react";
import { Gamepad2, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CONFIG_QUERY_KEY, useConfig } from "@hooks/useConfig";
import {
  inventoryGetLocal,
  inventoryScanAndPublish,
  setShareGameInventoryWithCloud,
} from "@services/tauri/inventory.service";
import { toastError, toastSuccess } from "@utils/toast";
import { formatRelativeDate } from "@utils/format";

export const INVENTORY_LOCAL_QUERY_KEY = ["inventory-local"] as const;

export function GameInventorySettingsCard() {
  const queryClient = useQueryClient();
  const { config } = useConfig();
  const sharing = config?.shareGameInventoryWithCloud ?? true;

  const { data: localInventory } = useQuery({
    queryKey: INVENTORY_LOCAL_QUERY_KEY,
    queryFn: inventoryGetLocal,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
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

  const verifiedGames = localInventory?.manifest?.games?.length ?? 0;
  const lastPublishedAt = localInventory?.manifest?.updatedAt ?? null;

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
              Comparte qué juegos tienes instalados y verificados para que otros miembros del cloud puedan transferirlos
              en la red local (estilo Steam).
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-default-200 bg-default-100/50 px-3 py-2.5 dark:border-default-100/15">
          <div className="min-w-0">
            <p className="text-sm font-medium text-default-700">Compartir inventario con el cloud</p>
            <p className="mt-0.5 text-xs text-default-500">
              Activado por defecto. Desactívalo si no quieres que otros vean tus juegos.
            </p>
          </div>
          <Switch
            isSelected={sharing}
            isDisabled={shareMutation.isPending}
            onValueChange={(enabled) => shareMutation.mutate(enabled)}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-default-500">
          <span>
            {verifiedGames > 0
              ? `${verifiedGames} juego(s) verificado(s)${lastPublishedAt ? ` · ${formatRelativeDate(lastPublishedAt)}` : ""}`
              : "Sin inventario local publicado todavía"}
          </span>
          <Button
            size="sm"
            variant="bordered"
            className="border-default-300/70"
            startContent={<RefreshCw size={14} className={scanMutation.isPending ? "animate-spin" : ""} />}
            isDisabled={scanMutation.isPending || !sharing}
            onPress={() => scanMutation.mutate()}>
            Reescanear ahora
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
