import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolvePeerInstallOffers } from "@services/tauri/inventory.service";

export const PEER_INSTALL_OFFERS_QUERY_KEY = ["peer-install-offers"] as const;

export function usePeerInstallOffers(steamAppId: string | null | undefined, enabled: boolean) {
  const trimmedId = steamAppId?.trim() ?? "";
  const queryEnabled = enabled && trimmedId.length > 0;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: [...PEER_INSTALL_OFFERS_QUERY_KEY, trimmedId],
    queryFn: () => resolvePeerInstallOffers(trimmedId),
    enabled: queryEnabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const offers = data?.offers ?? [];
  const gameKey = data?.gameKey ?? null;

  const selectedOffer = useMemo(() => {
    if (selectedDeviceId) {
      const picked = offers.find((o) => o.deviceId === selectedDeviceId);
      if (picked) return picked;
    }
    return offers.find((o) => o.reachableOnLan) ?? offers[0] ?? null;
  }, [offers, selectedDeviceId]);

  return {
    offers,
    gameKey,
    loading: isLoading || isFetching,
    selectedDeviceId: selectedOffer?.deviceId ?? null,
    setSelectedDeviceId,
    selectedOffer,
    refresh: refetch,
  };
}
