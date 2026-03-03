import { useState } from "react";
import { Button, Card, CardBody, Spinner } from "@heroui/react";
import { CloudUpload, RefreshCw } from "lucide-react";
import { useConfig } from "@hooks/useConfig";
import { syncUploadGame, type SyncResult } from "@services/tauri";
import type { ConfiguredGame } from "@app-types/config";
import { formatGameDisplayName } from "@utils/gameImage";

interface SyncPageProps {
  onNavigateToSettings?: () => void;
}

export function SyncPage({ onNavigateToSettings }: SyncPageProps) {
  const { config, loading, error, refetch } = useConfig();
  const [syncing, setSyncing] = useState<string | "all" | null>(null);
  const [lastResult, setLastResult] = useState<{
    gameId: string;
    result: SyncResult;
  } | null>(null);
  const [allResults, setAllResults] = useState<
    { gameId: string; result: SyncResult }[] | null
  >(null);

  const handleSyncOne = async (game: ConfiguredGame) => {
    setSyncing(game.id);
    setLastResult(null);
    setAllResults(null);
    try {
      const result = await syncUploadGame(game.id);
      setLastResult({ gameId: game.id, result });
    } catch (e) {
      setLastResult({
        gameId: game.id,
        result: {
          okCount: 0,
          errCount: 1,
          errors: [e instanceof Error ? e.message : String(e)],
        },
      });
    } finally {
      setSyncing(null);
    }
  };

  const handleSyncAll = async () => {
    if (!config?.games?.length) return;
    setSyncing("all");
    setLastResult(null);
    setAllResults([]);
    const results: { gameId: string; result: SyncResult }[] = [];
    for (const game of config.games) {
      try {
        const result = await syncUploadGame(game.id);
        results.push({ gameId: game.id, result });
      } catch (e) {
        results.push({
          gameId: game.id,
          result: {
            okCount: 0,
            errCount: 1,
            errors: [e instanceof Error ? e.message : String(e)],
          },
        });
      }
    }
    setAllResults(results);
    setSyncing(null);
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <Spinner size="lg" color="primary" />
        <p className="text-default-500">Cargando configuración...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <p className="text-danger">{error}</p>
        <Button
          color="primary"
          startContent={<RefreshCw size={18} />}
          onPress={() => refetch?.()}
        >
          Reintentar
        </Button>
      </div>
    );
  }

  const games = config?.games ?? [];
  const hasConfig =
    config?.apiBaseUrl?.trim() &&
    config?.userId?.trim() &&
    config?.apiKey?.trim();

  if (!hasConfig) {
    return (
      <div className="w-full max-w-5xl">
        <h1 className="mb-6 text-3xl font-semibold text-foreground">
          Sincronizar guardados
        </h1>
        <Card className="border border-warning-200 bg-warning-50/50 dark:border-warning-800 dark:bg-warning-900/20">
          <CardBody className="gap-2">
            <p className="text-warning-700 dark:text-warning-400">
              Para usar la nube necesitas configurar <strong>apiBaseUrl</strong>,{" "}
              <strong>userId</strong> y <strong>apiKey</strong>. El archivo{" "}
              <code className="rounded bg-default-100 px-1">config.json</code>{" "}
              debe estar en la carpeta de configuración de la app (en
              Configuración puedes ver la ruta). Si te enviaron un JSON, usa{" "}
              <strong>Importar (reemplazar)</strong> en Configuración para
              cargarlo en el sitio correcto.
            </p>
            {onNavigateToSettings && (
              <Button
                variant="flat"
                color="warning"
                onPress={onNavigateToSettings}
              >
                Ir a Configuración
              </Button>
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-foreground">
          Sincronizar guardados
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="solid"
            color="primary"
            startContent={
              syncing === "all" ? (
                <Spinner size="sm" color="current" />
              ) : (
                <CloudUpload size={18} />
              )
            }
            onPress={handleSyncAll}
            isDisabled={!games.length || !!syncing}
          >
            Subir todos
          </Button>
          <Button
            variant="flat"
            startContent={<RefreshCw size={18} />}
            onPress={() => refetch?.()}
          >
            Actualizar
          </Button>
        </div>
      </header>

      <p className="mb-6 text-default-500">
        Sube los guardados de tus juegos a la nube. Puedes subir todos o uno en
        específico.
      </p>

      {games.length === 0 ? (
        <Card className="border border-dashed border-default-300">
          <CardBody className="py-12 text-center">
            <CloudUpload size={48} className="mx-auto text-default-400" />
            <p className="mt-4 text-default-500">No hay juegos configurados.</p>
            <p className="mt-2 text-sm text-default-400">
              Añade juegos en la sección Juegos para poder sincronizarlos.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {games.map((game) => (
            <div
              key={game.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-default-200 bg-default-50/50 px-4 py-3 dark:bg-default-100/20"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">
                  {formatGameDisplayName(game.id)}
                </p>
                <p className="truncate text-sm text-default-500">
                  {game.paths.length} ruta{game.paths.length > 1 ? "s" : ""}
                </p>
              </div>
              <Button
                size="sm"
                color="primary"
                variant="flat"
                startContent={
                  syncing === game.id ? (
                    <Spinner size="sm" color="current" />
                  ) : (
                    <CloudUpload size={16} />
                  )
                }
                onPress={() => handleSyncOne(game)}
                isDisabled={!!syncing}
              >
                Subir
              </Button>
            </div>
          ))}
        </div>
      )}

      {(lastResult || allResults) && (
        <Card className="mt-6 border border-default-200">
          <CardBody>
            <h3 className="mb-3 font-medium text-foreground">
              {lastResult
                ? `Resultado: ${formatGameDisplayName(lastResult.gameId)}`
                : "Resultados de la sincronización"}
            </h3>
            {allResults ? (
              <div className="space-y-2">
                {allResults.map(({ gameId, result }) => (
                  <div key={gameId} className="text-sm">
                    <span className="font-medium">
                      {formatGameDisplayName(gameId)}:
                    </span>{" "}
                    {result.okCount} subido(s)
                    {result.errCount > 0 && (
                      <span className="text-danger">
                        , {result.errCount} error(es)
                      </span>
                    )}
                    {result.errors.length > 0 && (
                      <ul className="mt-1 list-inside list-disc text-default-500">
                        {result.errors.slice(0, 5).map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                        {result.errors.length > 5 && (
                          <li>… y {result.errors.length - 5} más</li>
                        )}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ) : lastResult ? (
              <div className="text-sm">
                <p>
                  {lastResult.result.okCount} archivo(s) subido(s)
                  {lastResult.result.errCount > 0 && (
                    <span className="text-danger">
                      , {lastResult.result.errCount} error(es)
                    </span>
                  )}
                </p>
                {lastResult.result.errors.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-default-500">
                    {lastResult.result.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
