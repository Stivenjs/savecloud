import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export interface PathValidationResult {
  exists: boolean;
  sizeBytes: number | null;
}

async function validatePath(path: string): Promise<PathValidationResult> {
  try {
    return await invoke<PathValidationResult>("check_path_size", { path });
  } catch (e) {
    console.error("Error validating path:", e);
    return { exists: false, sizeBytes: null };
  }
}

export function usePathValidation(path: string) {
  const trimmedPath = path.trim();

  const { isFetching, data } = useQuery({
    queryKey: ["path-validation", trimmedPath],
    queryFn: () => validatePath(trimmedPath),
    enabled: !!trimmedPath,
    staleTime: 1000 * 60 * 5, // cache válido por 5 minutos
  });

  return {
    isValidating: isFetching,
    result: data ?? null,
  };
}
