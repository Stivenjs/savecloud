import { useQuery } from "@tanstack/react-query";
import { evaluateRunCompatibility } from "@services/tauri";

export function useRunCompatibility(
  pcMinimum: string | null | undefined,
  pcRecommended: string | null | undefined,
  enabled: boolean
) {
  const min = pcMinimum?.trim() ?? "";
  const rec = pcRecommended?.trim() ?? "";

  return useQuery({
    queryKey: ["run-compatibility", min, rec],
    queryFn: () => evaluateRunCompatibility(min.length > 0 ? min : null, rec.length > 0 ? rec : null),
    enabled: enabled && (min.length > 0 || rec.length > 0),
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
}
