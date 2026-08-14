import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogListItem, SteamAppdetailsMediaResult, SourceBestMatch } from "@services/tauri";
import { catalogListItemToConfiguredGame } from "@features/steam-catalog/model/catalogConfiguredGame";
import { useDisclosure } from "@heroui/react";
import { startPeerGameDownload, startSourceDownload } from "@services/tauri";
import type { PeerInstallOffer } from "@services/tauri/inventory.service";
import { usePeerInstallOffers } from "@hooks/usePeerInstallOffers";
import { pickCandidate, sourceCandidateKey } from "@utils/sourceMatch";
import { toastError, toastSuccess } from "@utils/toast";
import { useConfig } from "@hooks/useConfig";
import type { ConfiguredGame } from "@app-types/config";
import { InstallModal } from "@features/steam-catalog/components/InstallModal";
import { SteamCatalogVirtualizedGrid } from "@features/steam-catalog/components/SteamCatalogVirtualizedGrid";

type PickByGame = Record<string, string>;

type SteamCatalogGridProps = {
  items: CatalogListItem[];
  listKey: string;
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  matchByGameName: Record<string, SourceBestMatch[]>;
  isMatchingPending: boolean;
  consoleMode?: boolean;
};

export function SteamCatalogGrid({
  items,
  listKey: _listKey,
  mediaBySteamAppId,
  matchByGameName,
  isMatchingPending,
  consoleMode = false,
}: SteamCatalogGridProps) {
  const { config } = useConfig();
  const { t } = useTranslation();
  const [pickByGame, setPickByGame] = useState<PickByGame>({});
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [installingGame, setInstallingGame] = useState<{
    name: string;
    size?: string | null;
    game: ConfiguredGame;
    chosen: SourceBestMatch;
  } | null>(null);

  const peerOffersHook = usePeerInstallOffers(installingGame?.game.steamAppId, isOpen && !!installingGame);

  const matchByGameNameRef = useRef(matchByGameName);
  const pickByGameRef = useRef(pickByGame);
  useEffect(() => {
    matchByGameNameRef.current = matchByGameName;
  }, [matchByGameName]);
  useEffect(() => {
    pickByGameRef.current = pickByGame;
  }, [pickByGame]);

  useEffect(() => {
    setPickByGame((prev) => {
      const next = { ...prev };
      for (const item of items) {
        const match = matchByGameName[item.name];
        const list = match ?? [];
        const best = list.length > 0 ? list[0] : undefined;

        if (best) {
          const currentPick = next[item.name];
          const isValidPick = currentPick && list.some((c) => sourceCandidateKey(c) === currentPick);

          if (!isValidPick) {
            next[item.name] = sourceCandidateKey(best);
          }
        } else {
          delete next[item.name];
        }
      }
      for (const k of Object.keys(next)) {
        if (!items.some((i) => i.name === k)) {
          delete next[k];
        }
      }
      return next;
    });
  }, [items, matchByGameName]);

  const handlePickChange = useCallback((gameName: string, key: string) => {
    setPickByGame((p) => ({ ...p, [gameName]: key }));
  }, []);

  const handleInstall = useCallback(
    async (gameName: string) => {
      const match = matchByGameNameRef.current[gameName];
      const chosen = pickCandidate(match, pickByGameRef.current[gameName]);
      if (!chosen) return;

      const item = items.find((i) => i.name === gameName);
      if (!item) return;

      setInstallingGame({
        name: gameName,
        size: chosen.file_size,
        game: catalogListItemToConfiguredGame(item),
        chosen,
      });
      onOpen();
    },
    [items, mediaBySteamAppId, onOpen]
  );

  const handleConfirmInstall = useCallback(
    async (selectedPath: string, selectedUri?: string | null) => {
      if (!installingGame) return;
      const { name, chosen } = installingGame;

      try {
        await startSourceDownload({
          sourceId: chosen.source_id,
          itemId: chosen.item_id,
          destinationDir: selectedPath.trim(),
          preferredProtocol: null,
          selectedUri: selectedUri ?? null,
        });

        toastSuccess(t("steamCatalog.grid.downloadStarted"), t("steamCatalog.grid.downloadStartedDesc", { name }));
      } catch (e) {
        toastError(t("steamCatalog.grid.downloadFailed"), e instanceof Error ? e.message : String(e));
      }
    },
    [installingGame, t]
  );

  const handleConfirmPeerInstall = useCallback(
    async (selectedPath: string, offer: PeerInstallOffer) => {
      if (!installingGame || !peerOffersHook.gameKey) return;
      const { name } = installingGame;

      try {
        await startPeerGameDownload({
          gameKey: peerOffersHook.gameKey,
          title: name,
          destinationDir: selectedPath.trim(),
          targetUserId: offer.userId,
          targetDeviceId: offer.deviceId,
          manifestHash: offer.manifestHash,
        });

        toastSuccess(
          t("steamCatalog.grid.transferStarted"),
          t("steamCatalog.grid.transferStartedDesc", { name, device: offer.deviceName })
        );
      } catch (e) {
        toastError(t("steamCatalog.grid.transferFailed"), e instanceof Error ? e.message : String(e));
      }
    },
    [installingGame, peerOffersHook.gameKey, t]
  );

  const libraryGamesMap = useMemo(() => {
    const map = new Map<string, ConfiguredGame>();
    if (!config?.games) return map;
    for (const g of config.games) {
      if (g.steamAppId) map.set(String(g.steamAppId), g);
      map.set(g.id.toLowerCase(), g);
    }
    return map;
  }, [config?.games]);

  return (
    <>
      <SteamCatalogVirtualizedGrid
        items={items}
        mediaBySteamAppId={mediaBySteamAppId}
        matchByGameName={matchByGameName}
        pickByGame={pickByGame}
        isMatchingPending={isMatchingPending}
        libraryGamesMap={libraryGamesMap}
        onPickChange={handlePickChange}
        onInstall={handleInstall}
        consoleMode={consoleMode}
      />

      {installingGame && (
        <InstallModal
          isOpen={isOpen}
          onOpenChange={onOpenChange}
          gameName={installingGame.name}
          gameSizeStr={installingGame.size}
          protocols={installingGame.chosen.protocols}
          uris={installingGame.chosen.uris}
          game={installingGame.game}
          mediaBySteamAppId={mediaBySteamAppId}
          peerOffers={peerOffersHook.offers}
          selectedPeerDeviceId={peerOffersHook.selectedDeviceId}
          onSelectPeerDevice={peerOffersHook.setSelectedDeviceId}
          onConfirm={handleConfirmInstall}
          onConfirmPeer={handleConfirmPeerInstall}
          consoleMode={consoleMode}
        />
      )}
    </>
  );
}
