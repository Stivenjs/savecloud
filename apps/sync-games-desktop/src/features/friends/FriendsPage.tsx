import { useMemo, useState } from "react";
import { Button, Card, CardBody, Input, Spinner } from "@heroui/react";
import { Download, Settings2, Users } from "lucide-react";
import type { Config, ConfiguredGame } from "@app-types/config";
import {
  getFriendConfig,
  syncListRemoteSavesForUser,
  syncListRemoteSaves,
  type RemoteSaveInfo,
} from "@services/tauri";
import type { CopyFriendFilePlan } from "@services/tauri";
import { useQueryClient } from "@tanstack/react-query";
import { formatSize } from "@utils/format";
import { GameCard } from "@features/games/GameCard";
import { copyFriendSavesWithPlan } from "@services/tauri";
import { toastError, toastInfo, toastSyncResult } from "@utils/toast";
import { FriendGameTemplateModal } from "@features/friends/FriendGameTemplateModal";

interface FriendGameSummary {
  game: ConfiguredGame;
  fileCount: number;
  totalSize: number;
}

export function FriendsPage() {
  const [friendIdInput, setFriendIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [friendConfig, setFriendConfig] = useState<Config | null>(null);
  const [friendSaves, setFriendSaves] = useState<RemoteSaveInfo[]>([]);
  const [copyingGameId, setCopyingGameId] = useState<string | null>(null);
  const [mySaves, setMySaves] = useState<RemoteSaveInfo[] | null>(null);
  const [templateGame, setTemplateGame] = useState<ConfiguredGame | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const queryClient = useQueryClient();

  const handleLoadFriend = async () => {
    const id = friendIdInput.trim();
    if (!id) {
      setError("Escribe el userId de tu amigo.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [cfg, saves] = await Promise.all([
        getFriendConfig(id),
        syncListRemoteSavesForUser(id),
      ]);
      setFriendConfig(cfg);
      setFriendSaves(saves);
    } catch (e) {
      setFriendConfig(null);
      setFriendSaves([]);
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo cargar el perfil del amigo."
      );
    } finally {
      setLoading(false);
    }
  };

  const summaries: FriendGameSummary[] = useMemo(() => {
    if (!friendConfig) return [];
    const byGame = new Map<string, { count: number; size: number }>();
    for (const s of friendSaves) {
      if (!byGame.has(s.gameId)) {
        byGame.set(s.gameId, { count: 0, size: 0 });
      }
      const agg = byGame.get(s.gameId)!;
      agg.count += 1;
      agg.size += s.size ?? 0;
    }
    return friendConfig.games.map((g) => {
      const agg = byGame.get(g.id) ?? { count: 0, size: 0 };
      return {
        game: g,
        fileCount: agg.count,
        totalSize: agg.size,
      };
    });
  }, [friendConfig, friendSaves]);

  const myGameIdsWithSaves = useMemo(() => {
    if (!mySaves) return new Set<string>();
    const set = new Set<string>();
    for (const s of mySaves) {
      set.add(s.gameId);
    }
    return set;
  }, [mySaves]);

  const handleCopySaves = async (gameId: string) => {
    const friendId = friendIdInput.trim();
    if (!friendId) {
      toastError(
        "Falta el userId del amigo",
        "Escribe el userId y carga el perfil primero."
      );
      return;
    }

    // Carga perezosa de mis guardados para saber si ya tengo algo
    if (mySaves === null) {
      try {
        const saves = await syncListRemoteSaves();
        setMySaves(saves);
      } catch {
        // en caso de error, seguimos sin bloqueo; solo perderíamos la advertencia
      }
    }

    // Asegurarse de tener mis guardados cargados para detectar conflictos
    let myAllSaves = mySaves;
    if (myAllSaves === null) {
      try {
        myAllSaves = await syncListRemoteSaves();
        setMySaves(myAllSaves);
      } catch {
        myAllSaves = [];
      }
    }

    const friendGameSaves = friendSaves.filter(
      (s) => s.gameId.toLowerCase() === gameId.toLowerCase()
    );
    if (friendGameSaves.length === 0) {
      toastInfo(
        "Sin guardados de amigo",
        "Tu amigo no tiene guardados para este juego."
      );
      return;
    }

    const myGameSaves = (myAllSaves ?? []).filter(
      (s) => s.gameId.toLowerCase() === gameId.toLowerCase()
    );
    const myFilenames = new Set(myGameSaves.map((s) => s.filename));

    const newFiles = friendGameSaves.filter(
      (s) => !myFilenames.has(s.filename)
    );
    const conflictFiles = friendGameSaves.filter((s) =>
      myFilenames.has(s.filename)
    );

    // Estrategia simple de resolución global: sobrescribir o renombrar conflictos
    type Strategy = "overwrite" | "rename";
    const strategy: Strategy =
      conflictFiles.length > 0 ? "rename" : "overwrite";

    const plan: CopyFriendFilePlan[] = [];
    const usedNames = new Set<string>([
      ...myFilenames,
      ...friendGameSaves.map((s) => s.filename),
    ]);

    const makeUniqueName = (base: string): string => {
      if (!usedNames.has(base)) {
        usedNames.add(base);
        return base;
      }
      const dot = base.lastIndexOf(".");
      const name = dot === -1 ? base : base.slice(0, dot);
      const ext = dot === -1 ? "" : base.slice(dot);
      let i = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const candidate = `${name} (amigo ${i})${ext}`;
        if (!usedNames.has(candidate)) {
          usedNames.add(candidate);
          return candidate;
        }
        i += 1;
      }
    };

    for (const s of newFiles) {
      plan.push({
        key: s.key,
        filename: s.filename,
        targetFilename: s.filename,
      });
    }

    if (strategy === "overwrite") {
      for (const s of conflictFiles) {
        plan.push({
          key: s.key,
          filename: s.filename,
          targetFilename: s.filename,
        });
      }
    } else if (strategy === "rename") {
      for (const s of conflictFiles) {
        plan.push({
          key: s.key,
          filename: s.filename,
          targetFilename: makeUniqueName(s.filename),
        });
      }
    }

    if (plan.length === 0) {
      toastInfo(
        "Nada que copiar",
        "Todos los archivos del amigo ya existen en tu nube."
      );
      return;
    }

    setCopyingGameId(gameId);
    try {
      const result = await copyFriendSavesWithPlan(friendId, gameId, plan);
      const hadBefore = myGameIdsWithSaves.has(gameId);
      const suffix =
        conflictFiles.length > 0 && strategy === "rename"
          ? " (conflictos renombrados)"
          : hadBefore
          ? " (ya tenías guardados, se han fusionado)"
          : "";
      toastSyncResult(result, `${gameId}${suffix}`);

      // Invalidar cache de última sync / juegos en la nube
      queryClient.invalidateQueries({ queryKey: ["last-sync-info"] });
    } catch (e) {
      toastError(
        "No se pudieron copiar los guardados",
        e instanceof Error ? e.message : "Ocurrió un error inesperado"
      );
    } finally {
      setCopyingGameId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Amigos</h1>
        <span className="inline-flex h-7 items-center rounded-full bg-default-100 px-3 text-xs text-default-500">
          Explora configuraciones de otros usuarios
        </span>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Input
              label="User ID del amigo"
              placeholder="ej. tu-amigo-123"
              value={friendIdInput}
              onValueChange={setFriendIdInput}
              variant="bordered"
              className="sm:max-w-xs"
            />
            <Button
              color="primary"
              onPress={handleLoadFriend}
              isLoading={loading}
              startContent={<Users size={18} />}
            >
              Cargar perfil
            </Button>
          </div>
          <p className="text-xs text-default-500">
            El userId es el identificador que tu amigo tiene configurado en su
            archivo de configuración. Usa esta vista solo con personas de
            confianza, ya que verás sus juegos y rutas de guardado.
          </p>
          {error && <p className="text-sm text-danger">{error}</p>}
        </CardBody>
      </Card>

      {!friendConfig && !loading && !error && (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <Users size={40} className="text-default-400" />
            <p className="text-default-500">
              Introduce el userId de un amigo para ver sus juegos y
              configuración.
            </p>
          </CardBody>
        </Card>
      )}

      {loading && (
        <div className="flex min-h-[20vh] flex-col items-center justify-center gap-3">
          <Spinner size="lg" color="primary" />
          <p className="text-default-500">Cargando perfil del amigo...</p>
        </div>
      )}

      {friendConfig && !loading && (
        <div className="space-y-4">
          <p className="text-sm text-default-500">
            Perfil de:{" "}
            <span className="font-mono text-default-700">
              {friendConfig.userId ?? "(sin userId en config)"}
            </span>
          </p>
          {summaries.length === 0 ? (
            <Card>
              <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-default-500">
                  Este amigo no tiene juegos configurados en su config.
                </p>
              </CardBody>
            </Card>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
              {summaries.map(({ game, fileCount, totalSize }) => {
                const hasSaves = fileCount > 0;
                const isCopying = copyingGameId === game.id;
                return (
                  <div key={game.id} className="space-y-1">
                    <GameCard
                      game={game}
                      resolvedSteamAppId={game.steamAppId}
                      isLoading={false}
                    />
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-default-500">
                          En la nube (amigo):{" "}
                          {hasSaves
                            ? `${fileCount} archivo${
                                fileCount !== 1 ? "s" : ""
                              } · ${formatSize(totalSize)}`
                            : "sin guardados"}
                        </p>
                        <Button
                          size="sm"
                          variant="flat"
                          color="primary"
                          startContent={<Download size={14} />}
                          isDisabled={!hasSaves || !!copyingGameId}
                          isLoading={isCopying}
                          onPress={() => handleCopySaves(game.id)}
                        >
                          Copiar saves
                        </Button>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="light"
                          startContent={<Settings2 size={14} />}
                          onPress={() => {
                            setTemplateGame(game);
                            setTemplateOpen(true);
                          }}
                        >
                          Usar config como plantilla
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <FriendGameTemplateModal
        isOpen={templateOpen}
        game={templateGame}
        onClose={() => setTemplateOpen(false)}
      />
    </div>
  );
}
