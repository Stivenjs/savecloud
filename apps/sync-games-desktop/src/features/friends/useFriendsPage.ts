import { useMemo, useReducer } from "react";
import type { Config, ConfiguredGame } from "@app-types/config";
import type { CopyFriendFilePlan } from "@services/tauri";
import type { RemoteSaveInfo } from "@services/tauri";
import {
  addGamesFromFriend,
  copyFriendSaves,
  copyFriendSavesWithPlan,
  getFriendConfig,
  syncListRemoteSaves,
  syncListRemoteSavesForUser,
} from "@services/tauri";
import {
  extractShareTokenFromUrl,
  resolveShareToken,
} from "@services/share.service";
import { toastError, toastInfo, toastSyncResult } from "@utils/toast";
import { useConfig } from "@hooks/useConfig";
import { useQueryClient } from "@tanstack/react-query";

export interface FriendGameSummary {
  game: ConfiguredGame;
  fileCount: number;
  totalSize: number;
}

export type ShareLinkPreview = {
  userId: string;
  gameId: string;
  gameName?: string;
  friendGame?: ConfiguredGame;
  files: { filename: string; size?: number }[];
};

/** Preview antes de confirmar la copia de guardados del amigo a tu nube. */
export type CopyFriendSavesPreview = {
  friendId: string;
  gameId: string;
  gameDisplayName?: string;
  plan: CopyFriendFilePlan[];
  newCount: number;
  conflictCount: number;
  strategy: "overwrite" | "rename";
};

type FriendsPageState = {
  friendIdInput: string;
  loading: boolean;
  error: string | null;
  friendConfig: Config | null;
  friendSaves: RemoteSaveInfo[];
  copyingGameId: string | null;
  mySaves: RemoteSaveInfo[] | null;
  templateGame: ConfiguredGame | null;
  templateOpen: boolean;
  addFriendGamesOpen: boolean;
  shareLinkInput: string;
  shareLinkLoading: boolean;
  shareLinkConfirmLoading: boolean;
  shareLinkPreview: ShareLinkPreview | null;
  copyConfirmPreview: CopyFriendSavesPreview | null;
};

type FriendsPageAction =
  | { type: "SET_FRIEND_ID_INPUT"; payload: string }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_FRIEND_DATA"; config: Config | null; saves: RemoteSaveInfo[] }
  | { type: "SET_COPYING_GAME_ID"; payload: string | null }
  | { type: "SET_MY_SAVES"; payload: RemoteSaveInfo[] | null }
  | { type: "SET_TEMPLATE"; game: ConfiguredGame | null; open: boolean }
  | { type: "SET_ADD_FRIEND_GAMES_OPEN"; payload: boolean }
  | { type: "SET_SHARE_LINK_INPUT"; payload: string }
  | { type: "SET_SHARE_LINK_LOADING"; payload: boolean }
  | { type: "SET_SHARE_LINK_CONFIRM_LOADING"; payload: boolean }
  | { type: "SET_SHARE_LINK_PREVIEW"; payload: ShareLinkPreview | null }
  | { type: "SET_COPY_CONFIRM_PREVIEW"; payload: CopyFriendSavesPreview | null };

const initialState: FriendsPageState = {
  friendIdInput: "",
  loading: false,
  error: null,
  friendConfig: null,
  friendSaves: [],
  copyingGameId: null,
  mySaves: null,
  templateGame: null,
  templateOpen: false,
  addFriendGamesOpen: false,
  shareLinkInput: "",
  shareLinkLoading: false,
  shareLinkConfirmLoading: false,
  shareLinkPreview: null,
  copyConfirmPreview: null,
};

function friendsPageReducer(
  state: FriendsPageState,
  action: FriendsPageAction
): FriendsPageState {
  switch (action.type) {
    case "SET_FRIEND_ID_INPUT":
      return { ...state, friendIdInput: action.payload };
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "SET_FRIEND_DATA":
      return {
        ...state,
        friendConfig: action.config,
        friendSaves: action.saves,
      };
    case "SET_COPYING_GAME_ID":
      return { ...state, copyingGameId: action.payload };
    case "SET_MY_SAVES":
      return { ...state, mySaves: action.payload };
    case "SET_TEMPLATE":
      return { ...state, templateGame: action.game, templateOpen: action.open };
    case "SET_ADD_FRIEND_GAMES_OPEN":
      return { ...state, addFriendGamesOpen: action.payload };
    case "SET_SHARE_LINK_INPUT":
      return { ...state, shareLinkInput: action.payload };
    case "SET_SHARE_LINK_LOADING":
      return { ...state, shareLinkLoading: action.payload };
    case "SET_SHARE_LINK_CONFIRM_LOADING":
      return { ...state, shareLinkConfirmLoading: action.payload };
    case "SET_SHARE_LINK_PREVIEW":
      return { ...state, shareLinkPreview: action.payload };
    case "SET_COPY_CONFIRM_PREVIEW":
      return { ...state, copyConfirmPreview: action.payload };
    default:
      return state;
  }
}

export function useFriendsPage() {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(friendsPageReducer, initialState);
  const {
    friendIdInput,
    loading,
    error,
    friendConfig,
    friendSaves,
    copyingGameId,
    mySaves,
    templateGame,
    templateOpen,
    addFriendGamesOpen,
    shareLinkInput,
  shareLinkLoading,
  shareLinkConfirmLoading,
  shareLinkPreview,
  copyConfirmPreview,
} = state;

  const { config: ourConfig } = useConfig();

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

  const ourGameIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of ourConfig?.games ?? []) {
      if (g.id) set.add(g.id.toLowerCase());
    }
    return set;
  }, [ourConfig?.games]);

  const handleLoadFriend = async () => {
    const id = friendIdInput.trim();
    if (!id) {
      dispatch({
        type: "SET_ERROR",
        payload: "Escribe el userId de tu amigo.",
      });
      return;
    }
    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const [cfg, saves] = await Promise.all([
        getFriendConfig(id),
        syncListRemoteSavesForUser(id),
      ]);
      dispatch({ type: "SET_FRIEND_DATA", config: cfg, saves });
    } catch (e) {
      dispatch({ type: "SET_FRIEND_DATA", config: null, saves: [] });
      dispatch({
        type: "SET_ERROR",
        payload:
          e instanceof Error
            ? e.message
            : "No se pudo cargar el perfil del amigo.",
      });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  const handleImportFromShareLink = async () => {
    const token = extractShareTokenFromUrl(shareLinkInput);
    if (!token) {
      toastError(
        "Link inválido",
        "Pega la URL completa del link compartido o solo el código."
      );
      return;
    }
    const base = ourConfig?.apiBaseUrl?.trim();
    if (!base) {
      toastError(
        "Falta configuración",
        "Configura la URL de la API en Configuración."
      );
      return;
    }
    dispatch({ type: "SET_SHARE_LINK_LOADING", payload: true });
    dispatch({ type: "SET_SHARE_LINK_PREVIEW", payload: null });
    try {
      const { userId, gameId } = await resolveShareToken(base, token);
      const [friendCfg, saves] = await Promise.all([
        getFriendConfig(userId).catch(() => null),
        syncListRemoteSavesForUser(userId),
      ]);
      const gameSaves = saves.filter(
        (s) => s.gameId.toLowerCase() === gameId.toLowerCase()
      );
      const friendGame = friendCfg?.games?.find(
        (g) => g.id.toLowerCase() === gameId.toLowerCase()
      );
      dispatch({
        type: "SET_SHARE_LINK_PREVIEW",
        payload: {
          userId,
          gameId,
          gameName: friendGame?.id,
          friendGame: friendGame ?? undefined,
          files: gameSaves.map((s) => ({ filename: s.filename, size: s.size })),
        },
      });
    } catch (e) {
      toastError(
        "No se pudo cargar el link",
        e instanceof Error ? e.message : "Link inválido o expirado"
      );
    } finally {
      dispatch({ type: "SET_SHARE_LINK_LOADING", payload: false });
    }
  };

  const handleConfirmShareLinkImport = async () => {
    if (!shareLinkPreview) return;
    const { userId, gameId, friendGame } = shareLinkPreview;
    dispatch({ type: "SET_SHARE_LINK_CONFIRM_LOADING", payload: true });
    try {
      const result = await copyFriendSaves(userId, gameId);
      const alreadyHave = ourGameIds.has(gameId.toLowerCase());
      if (!alreadyHave) {
        const gameToAdd = friendGame
          ? {
              id: friendGame.id,
              paths: ["(editar ruta en Configuración)"],
              steamAppId: friendGame.steamAppId ?? undefined,
              imageUrl: friendGame.imageUrl ?? undefined,
              editionLabel: friendGame.editionLabel ?? undefined,
              sourceUrl: friendGame.sourceUrl ?? undefined,
            }
          : {
              id: gameId,
              paths: ["(editar ruta en Configuración)"],
            };
        await addGamesFromFriend([gameToAdd]);
      }
      toastSyncResult(result, gameId);
      dispatch({ type: "SET_SHARE_LINK_INPUT", payload: "" });
      dispatch({ type: "SET_SHARE_LINK_PREVIEW", payload: null });
      queryClient.invalidateQueries({ queryKey: ["last-sync-info"] });
      queryClient.invalidateQueries({ queryKey: ["config"] });
    } catch (e) {
      toastError(
        "No se pudo importar",
        e instanceof Error ? e.message : "Error inesperado"
      );
    } finally {
      dispatch({ type: "SET_SHARE_LINK_CONFIRM_LOADING", payload: false });
    }
  };

  const handleCopySaves = async (gameId: string) => {
    const friendId = friendIdInput.trim();
    if (!friendId) {
      toastError(
        "Falta el userId del amigo",
        "Escribe el userId y carga el perfil primero."
      );
      return;
    }

    if (mySaves === null) {
      try {
        const saves = await syncListRemoteSaves();
        dispatch({ type: "SET_MY_SAVES", payload: saves });
      } catch {
        // en caso de error, seguimos sin bloqueo
      }
    }

    let myAllSaves = mySaves;
    if (myAllSaves === null) {
      try {
        myAllSaves = await syncListRemoteSaves();
        dispatch({ type: "SET_MY_SAVES", payload: myAllSaves });
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
    } else {
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

    const gameDisplayName =
      friendConfig?.games?.find(
        (g) => g.id.toLowerCase() === gameId.toLowerCase()
      )?.id ?? gameId;
    dispatch({
      type: "SET_COPY_CONFIRM_PREVIEW",
      payload: {
        friendId,
        gameId,
        gameDisplayName,
        plan,
        newCount: newFiles.length,
        conflictCount: conflictFiles.length,
        strategy,
      },
    });
  };

  const handleConfirmCopySaves = async () => {
    if (!copyConfirmPreview) return;
    const preview = copyConfirmPreview;
    const { friendId, gameId, plan } = preview;
    dispatch({ type: "SET_COPY_CONFIRM_PREVIEW", payload: null });
    dispatch({ type: "SET_COPYING_GAME_ID", payload: gameId });
    try {
      const result = await copyFriendSavesWithPlan(friendId, gameId, plan);
      const hadBefore = myGameIdsWithSaves.has(gameId);
      const suffix =
        preview.conflictCount > 0 && preview.strategy === "rename"
          ? " (conflictos renombrados)"
          : hadBefore
            ? " (ya tenías guardados, se han fusionado)"
            : "";
      toastSyncResult(result, `${gameId}${suffix}`);
      queryClient.invalidateQueries({ queryKey: ["last-sync-info"] });
    } catch (e) {
      toastError(
        "No se pudieron copiar los guardados",
        e instanceof Error ? e.message : "Ocurrió un error inesperado"
      );
    } finally {
      dispatch({ type: "SET_COPYING_GAME_ID", payload: null });
    }
  };

  const setFriendIdInput = (v: string) =>
    dispatch({ type: "SET_FRIEND_ID_INPUT", payload: v });
  const setTemplateGame = (game: ConfiguredGame | null) =>
    dispatch({ type: "SET_TEMPLATE", game, open: game !== null });
  const setTemplateOpen = (open: boolean) =>
    dispatch({ type: "SET_TEMPLATE", game: templateGame, open });
  const setAddFriendGamesOpen = (v: boolean) =>
    dispatch({ type: "SET_ADD_FRIEND_GAMES_OPEN", payload: v });
  const setShareLinkInput = (v: string) =>
    dispatch({ type: "SET_SHARE_LINK_INPUT", payload: v });
  const setShareLinkPreview = (v: ShareLinkPreview | null) =>
    dispatch({ type: "SET_SHARE_LINK_PREVIEW", payload: v });
  const setCopyConfirmPreview = (v: CopyFriendSavesPreview | null) =>
    dispatch({ type: "SET_COPY_CONFIRM_PREVIEW", payload: v });

  return {
    friendIdInput,
    setFriendIdInput,
    loading,
    error,
    friendConfig,
    summaries,
    copyingGameId,
    ourGameIds,
    templateGame,
    setTemplateGame,
    templateOpen,
    setTemplateOpen,
    addFriendGamesOpen,
    setAddFriendGamesOpen,
    shareLinkInput,
    setShareLinkInput,
    shareLinkLoading,
    shareLinkPreview,
    setShareLinkPreview,
    shareLinkConfirmLoading,
    copyConfirmPreview,
    setCopyConfirmPreview,
    handleConfirmCopySaves,
    ourConfig,
    handleLoadFriend,
    handleImportFromShareLink,
    handleConfirmShareLinkImport,
    handleCopySaves,
    invalidateConfig: () =>
      queryClient.invalidateQueries({ queryKey: ["config"] }),
  };
}
