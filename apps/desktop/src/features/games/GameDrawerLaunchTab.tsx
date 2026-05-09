import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
} from "@heroui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { type as getOsType } from "@tauri-apps/plugin-os";
import { AppWindow, Cpu, FileSearch, RotateCcw, Trash2 } from "lucide-react";
import type { GameFormState } from "@/hooks/useGameForm";
import { listRunningProcessesForPick } from "@/services/tauri";

/** Diálogo del SO: permite launchers tipo .jar, scripts y ejecutables sin forzar marca comercial ni rutas fijas. */
function launchTargetDialogFilters(): { name: string; extensions: string[] }[] {
  const os = getOsType();
  if (os === "windows") {
    return [
      { name: "Ejecutables, Java .jar y scripts", extensions: ["exe", "jar", "bat", "cmd"] },
      { name: "Todos los archivos", extensions: ["*"] },
    ];
  }
  if (os === "macos") {
    return [
      { name: "Apps y scripts", extensions: ["app", "jar", "sh", "command"] },
      { name: "Todos los archivos", extensions: ["*"] },
    ];
  }
  return [
    {
      name: "Ejecutables y scripts",
      extensions: ["jar", "sh", "AppImage", "run"],
    },
    { name: "Todos los archivos", extensions: ["*"] },
  ];
}

interface GameDrawerLaunchTabProps {
  form: GameFormState;
  setField: <K extends keyof GameFormState>(key: K, value: GameFormState[K]) => void;
  setError: (error: string | null) => void;
  isOpen: boolean;
}

export function GameDrawerLaunchTab({ form, setField, setError, isOpen }: GameDrawerLaunchTabProps) {
  const [processModalOpen, setProcessModalOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const {
    data: runningRows = [],
    isLoading: runningLoading,
    refetch: refetchProcesses,
  } = useQuery({
    queryKey: ["running-processes-for-pick"],
    queryFn: listRunningProcessesForPick,
    enabled: processModalOpen && isOpen,
    staleTime: 15_000,
  });

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return runningRows;
    return runningRows.filter((r) => r.name.toLowerCase().includes(q));
  }, [runningRows, filter]);

  const handlePickExecutable = useCallback(async () => {
    setError(null);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Seleccionar programa para lanzar el juego",
        filters: launchTargetDialogFilters(),
      });
      if (selected && typeof selected === "string") {
        setField("launchExecutablePath", selected);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [setError, setField]);

  const handleClearLaunch = useCallback(() => {
    setField("launchExecutablePath", "");
  }, [setField]);

  const handleOpenProcessModal = useCallback(() => {
    setFilter("");
    setProcessModalOpen(true);
    void refetchProcesses();
  }, [refetchProcesses]);

  const handleSelectProcess = useCallback(
    (name: string) => {
      setField("executableNames", [name]);
      setProcessModalOpen(false);
    },
    [setField]
  );

  const handleResetProcessDetection = useCallback(() => {
    setField("executableNames", []);
  }, [setField]);

  const manualNames = form.executableNames.length > 0 ? form.executableNames.join(", ") : null;
  const hasLaunchPath = Boolean(form.launchExecutablePath.trim());

  return (
    <>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-default-500">
          Estos datos se guardan al pulsar «Añadir» o «Guardar cambios». El botón «Jugar» solo se habilita cuando hay
          aquí un archivo elegido (.exe en Windows; también puedes usar .jar, .bat/.cmd / scripts según sistema).
        </p>

        <Card className="border border-default-200/60 shadow-sm">
          <CardBody className="space-y-3 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-semibold text-default-700">Archivo para lanzar</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="bordered"
                  startContent={<FileSearch size={16} />}
                  onPress={handlePickExecutable}>
                  Elegir archivo
                </Button>
                {hasLaunchPath && (
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    startContent={<Trash2 size={16} />}
                    onPress={handleClearLaunch}>
                    Quitar
                  </Button>
                )}
              </div>
            </div>
            {hasLaunchPath ? (
              <p className="break-all font-mono text-xs text-default-500" title={form.launchExecutablePath}>
                {form.launchExecutablePath}
              </p>
            ) : (
              <p className="text-xs text-default-400">
                Sin archivo: no podrás usar «Jugar» hasta que elijas uno (filtro amplio en el selector; también «Todos
                los archivos»).
              </p>
            )}
          </CardBody>
        </Card>

        <Card className="border border-default-200/60 shadow-sm">
          <CardBody className="space-y-3 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-default-700">
                <Cpu size={16} />
                Detección de proceso
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="bordered" onPress={handleOpenProcessModal}>
                  Elegir proceso en ejecución
                </Button>
                {manualNames && (
                  <Button
                    size="sm"
                    variant="light"
                    startContent={<RotateCcw size={16} />}
                    onPress={handleResetProcessDetection}>
                    Automático
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-default-500">
              Si SaveCloud no detecta cuando el juego está abierto, abre el juego, vuelve aquí y elige el mismo nombre
              de proceso que en el Administrador de tareas.
            </p>
            {manualNames ? (
              <div className="flex flex-wrap gap-2">
                {form.executableNames.map((n) => (
                  <Chip key={n} size="sm" variant="flat" color="primary">
                    {n}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-default-400">Inferencia automática según el nombre del juego.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        isOpen={processModalOpen}
        onOpenChange={(open) => {
          if (!open) setProcessModalOpen(false);
        }}
        size="2xl"
        scrollBehavior="inside"
        placement="center">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>Proceso en ejecución</span>
            <span className="text-xs font-normal text-default-500">
              Elige el proceso que coincida con tu juego (en Windows suele llevar el mismo icono que en Administrador de
              tareas).
            </span>
          </ModalHeader>
          <ModalBody className="gap-3">
            <Input
              label="Filtrar"
              placeholder="Escribe parte del nombre…"
              value={filter}
              onValueChange={setFilter}
              size="sm"
            />
            <div className="max-h-72 overflow-y-auto rounded-medium border border-default-200 p-2">
              {runningLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner size="sm" />
                </div>
              ) : filteredRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-default-400">
                  {runningRows.length === 0 ? "No hay procesos listados." : "Ningún resultado con ese filtro."}
                </p>
              ) : (
                <ul className="space-y-1">
                  {filteredRows.map((row) => (
                    <li key={row.name}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-medium px-3 py-2 text-left text-sm transition-colors hover:bg-default-100"
                        onClick={() => handleSelectProcess(row.name)}>
                        {row.iconPngBase64 ? (
                          <img
                            src={`data:image/png;base64,${row.iconPngBase64}`}
                            alt=""
                            className="h-7 w-7 shrink-0 rounded-medium object-contain"
                            draggable={false}
                            loading="lazy"
                          />
                        ) : (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-medium bg-default-100">
                            <AppWindow className="h-4 w-4 text-default-400" aria-hidden />
                          </span>
                        )}
                        <span className="min-w-0 truncate">{row.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setProcessModalOpen(false)}>
              Cerrar
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
