import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardBody,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
} from "@heroui/react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import {
  createConfigFile,
  exportConfigToFile,
  getConfigPath,
  importConfigFromFile,
  checkForUpdatesWithPrompt,
} from "@services/tauri";
import { useConfig } from "@hooks/useConfig";
import { useQueryClient } from "@tanstack/react-query";
import { toastError, toastSuccess } from "@utils/toast";
import { notifyTest } from "@utils/notification";

export function SettingsPage() {
  const [autostart, setAutostart] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testingNotification, setTestingNotification] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [configPath, setConfigPath] = useState<string>("");
  const [createConfigModalOpen, setCreateConfigModalOpen] = useState(false);
  const [createApiBaseUrl, setCreateApiBaseUrl] = useState("");
  const [createApiKey, setCreateApiKey] = useState("");
  const [createUserId, setCreateUserId] = useState("");
  const [creatingConfig, setCreatingConfig] = useState(false);
  const [createConfigError, setCreateConfigError] = useState<string | null>(null);

  const { config, refetch: refetchConfig } = useConfig();
  const queryClient = useQueryClient();

  const handleExportConfig = async () => {
    setExporting(true);
    try {
      const path = await save({
        title: "Exportar configuración",
        defaultPath: "sync-games-config.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path) {
        await exportConfigToFile(path);
        toastSuccess("Configuración exportada", path);
      }
    } catch (e) {
      toastError(
        "Error al exportar",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setExporting(false);
    }
  };

  const handleImportConfig = async (mode: "merge" | "replace") => {
    setImporting(true);
    try {
      const path = await open({
        title: "Importar configuración",
        directory: false,
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path && typeof path === "string") {
        await importConfigFromFile(path, mode);
        toastSuccess(
          "Configuración importada",
          mode === "merge" ? "Juegos fusionados" : "Configuración reemplazada"
        );
        window.location.reload();
      }
    } catch (e) {
      toastError(
        "Error al importar",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setImporting(false);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    try {
      await checkForUpdatesWithPrompt();
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleTestNotification = async () => {
    setTestingNotification(true);
    try {
      const ok = await notifyTest();
      if (!ok) {
        alert(
          "Los permisos para notificaciones no están concedidos. Revisa la configuración del sistema."
        );
      }
    } finally {
      setTestingNotification(false);
    }
  };

  useEffect(() => {
    isEnabled()
      .then(setAutostart)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    getConfigPath().then(setConfigPath);
  }, []);

  useEffect(() => {
    if (createConfigModalOpen && config) {
      setCreateApiBaseUrl(config.apiBaseUrl ?? "");
      setCreateApiKey(config.apiKey ?? "");
      setCreateUserId(config.userId ?? "");
    }
  }, [createConfigModalOpen, config?.apiBaseUrl, config?.apiKey, config?.userId]);

  const handleCreateConfigFile = async () => {
    setCreatingConfig(true);
    setCreateConfigError(null);
    try {
      const path = await createConfigFile(
        createApiBaseUrl,
        createApiKey,
        createUserId
      );
      toastSuccess("Archivo de configuración creado", path);
      setCreateConfigModalOpen(false);
      refetchConfig?.();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      const newPath = await getConfigPath();
      setConfigPath(newPath);
    } catch (e) {
      setCreateConfigError(
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setCreatingConfig(false);
    }
  };

  const handleAutostartChange = async (checked: boolean) => {
    try {
      if (checked) {
        await enable();
      } else {
        await disable();
      }
      setAutostart(checked);
    } catch (e) {
      console.error("Error al cambiar autostart:", e);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Configuración</h1>
      <Card>
        <CardBody className="gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">Iniciar con Windows</p>
                <p className="text-sm text-default-500">
                  Abrir sync-games automáticamente al iniciar sesión en el
                  equipo
                </p>
              </div>
              <Switch
                isSelected={autostart}
                onValueChange={handleAutostartChange}
                isDisabled={loading}
              />
            </div>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody className="gap-4">
          <p className="font-medium">Actualizaciones</p>
          <p className="text-sm text-default-500">
            Comprueba si hay una nueva versión disponible e instálala.
          </p>
          <Button
            size="sm"
            variant="flat"
            onPress={handleCheckUpdates}
            isLoading={checkingUpdate}
          >
            Buscar actualizaciones
          </Button>
        </CardBody>
      </Card>
      <Card>
        <CardBody className="gap-4">
          <p className="font-medium">Notificaciones</p>
          <p className="text-sm text-default-500">
            Se muestran notificaciones cuando se suben guardados automáticamente
            (por ejemplo, con la app en la bandeja).
          </p>
          <Button
            size="sm"
            variant="flat"
            onPress={handleTestNotification}
            isLoading={testingNotification}
          >
            Probar notificación
          </Button>
        </CardBody>
      </Card>
      <Card>
        <CardBody className="gap-4">
          <p className="font-medium">Exportar / Importar configuración</p>
          <p className="text-sm text-default-500">
            Exporta la lista de juegos y rutas a JSON para usar en otra PC.
            Importar fusiona juegos nuevos o reemplaza toda la configuración.
            Si no tienes archivo de configuración, créalo con los datos de la API
            y aparecerán las opciones de subir a la nube.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="flat"
              color="primary"
              onPress={() => {
                setCreateConfigError(null);
                setCreateConfigModalOpen(true);
              }}
            >
              Crear archivo de configuración
            </Button>
            <Button
              size="sm"
              variant="flat"
              onPress={handleExportConfig}
              isLoading={exporting}
            >
              Exportar
            </Button>
            <Button
              size="sm"
              variant="flat"
              onPress={() => handleImportConfig("merge")}
              isLoading={importing}
            >
              Importar (fusionar)
            </Button>
            <Button
              size="sm"
              variant="flat"
              color="warning"
              onPress={() => handleImportConfig("replace")}
              isLoading={importing}
            >
              Importar (reemplazar)
            </Button>
          </div>
          {configPath ? (
            <div className="mt-2 rounded-md bg-default-100 p-3 text-sm">
              <p className="font-medium text-default-700">
                Ruta del archivo de configuración
              </p>
              <p className="mt-1 break-all font-mono text-default-600">
                {configPath}
              </p>
              <p className="mt-2 text-default-500">
                La app solo lee <code className="rounded px-1 bg-default-200">config.json</code> desde
                esta ruta. Si te enviaron un JSON, usa &quot;Importar
                (reemplazar)&quot; arriba para cargarlo aquí. El JSON debe tener{" "}
                <code className="rounded px-1 bg-default-200">apiBaseUrl</code>,{" "}
                <code className="rounded px-1 bg-default-200">userId</code> y{" "}
                <code className="rounded px-1 bg-default-200">apiKey</code> (en
                camelCase) para que aparezcan las opciones de subir a la nube.
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>
      <Modal
        isOpen={createConfigModalOpen}
        onOpenChange={(open) => {
          if (!open) setCreateConfigModalOpen(false);
        }}
        placement="center"
        size="lg"
      >
        <ModalContent>
          <ModalHeader>Crear archivo de configuración</ModalHeader>
          <ModalBody className="gap-4">
            <p className="text-sm text-default-500">
              Introduce los datos de tu API. El archivo se creará en la carpeta
              de configuración de la app. Si ya existe, solo se actualizarán
              estos campos (se mantienen juegos y rutas).
            </p>
            <Input
              label="URL de la API (apiBaseUrl)"
              placeholder="https://tu-api.ejemplo.com"
              value={createApiBaseUrl}
              onValueChange={setCreateApiBaseUrl}
              variant="bordered"
            />
            <Input
              label="User ID (userId)"
              placeholder="tu-user-id"
              value={createUserId}
              onValueChange={setCreateUserId}
              variant="bordered"
            />
            <Input
              label="API Key (apiKey)"
              placeholder="tu-api-key"
              type="password"
              value={createApiKey}
              onValueChange={setCreateApiKey}
              variant="bordered"
            />
            {createConfigError ? (
              <p className="text-sm text-danger">{createConfigError}</p>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => setCreateConfigModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              color="primary"
              onPress={handleCreateConfigFile}
              isLoading={creatingConfig}
            >
              Crear archivo
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Card>
        <CardBody>
          <p className="font-medium">Respaldo local</p>
          <p className="text-sm text-default-500">
            Antes de descargar guardados desde la nube, se crea una copia de
            seguridad en la carpeta de configuración:{" "}
            <code className="rounded bg-default-100 px-1">
              sync-games/backups/[juego]/[fecha]
            </code>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
