import { Button, Card, CardBody, Select, SelectItem } from "@heroui/react";
import { Archive, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cleanupOldBackups, setKeepBackupsPerGame, deleteAllLocalBackups } from "@services/tauri/config.service";
import { toastError, toastSuccess } from "@utils/toast";
import { useConfig } from "@hooks/useConfig";

const KEEP_OPTIONS = [3, 5, 10, 20] as const;
const DEFAULT_KEEP = 10;

export function LocalBackupInfoCard() {
  const { config, refetch } = useConfig();
  const [keepLastN, setKeepLastN] = useState(DEFAULT_KEEP);
  const [cleaning, setCleaning] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  useEffect(() => {
    const n = config?.keepBackupsPerGame ?? DEFAULT_KEEP;
    setKeepLastN(KEEP_OPTIONS.includes(n as (typeof KEEP_OPTIONS)[number]) ? n : DEFAULT_KEEP);
  }, [config?.keepBackupsPerGame]);

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const result = await cleanupOldBackups(keepLastN);
      if (result.backupsDeleted > 0) {
        toastSuccess(
          "Espacio liberado",
          `Se eliminaron ${result.backupsDeleted} backup(s) en ${result.gamesAffected} juego(s). Se mantienen los últimos ${keepLastN} por juego.`
        );
      } else {
        toastSuccess(
          "Sin cambios",
          "No había backups antiguos que eliminar. Se mantienen los últimos " + keepLastN + " por juego."
        );
      }
    } catch (e) {
      toastError("Error al liberar espacio", e instanceof Error ? e.message : String(e));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Card className="border border-default-200 bg-default-50/30">
      <CardBody className="gap-4">
        <div className="flex items-center gap-2">
          <Archive size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">Respaldo local automático</h2>
        </div>

        <p className="text-sm text-default-600">
          Antes de descargar guardados desde la nube, la app crea una copia de seguridad en tu PC para no sobrescribir
          nada sin respaldo. Las copias se guardan en la carpeta de configuración:{" "}
          <code className="rounded bg-default-200 px-1 font-mono text-xs">SaveCloud/backups/[juego]/[fecha]</code>
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-default-600">
            Mantener últimos
            <Select
              selectedKeys={[String(keepLastN)]}
              onSelectionChange={async (keys) => {
                const value = Number(Array.from(keys)[0]) as (typeof KEEP_OPTIONS)[number];
                setKeepLastN(value);
                try {
                  await setKeepBackupsPerGame(value);
                  await refetch();
                } catch (e) {
                  toastError("Error al guardar", e instanceof Error ? e.message : String(e));
                }
              }}
              className="min-w-[90px]"
              size="sm">
              {KEEP_OPTIONS.map((n) => (
                <SelectItem key={String(n)} textValue={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </Select>
            backups por juego
          </label>

          <Button
            size="sm"
            variant="flat"
            color="primary"
            onPress={handleCleanup}
            isLoading={cleaning}
            startContent={<Trash2 size={16} />}>
            Liberar espacio ahora
          </Button>

          {confirmDeleteAll ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-default-600">
              <span className="font-medium">¿Borrar TODOS los backups locales? Esta acción no se puede deshacer.</span>
              <Button
                size="sm"
                variant="flat"
                color="danger"
                isLoading={cleaning}
                onPress={async () => {
                  setCleaning(true);
                  try {
                    await deleteAllLocalBackups();
                    toastSuccess(
                      "Backups locales eliminados",
                      "Se borraron todas las copias locales en SaveCloud/backups."
                    );
                    setConfirmDeleteAll(false);
                  } catch (e) {
                    toastError("Error al borrar backups", e instanceof Error ? e.message : String(e));
                  } finally {
                    setCleaning(false);
                  }
                }}>
                Confirmar borrado
              </Button>
              <Button size="sm" variant="light" onPress={() => setConfirmDeleteAll(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="flat" color="danger" onPress={() => setConfirmDeleteAll(true)}>
              Borrar todos los backups locales
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
