import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 120_000, // 2 minutos para liberar la memoria JS de queries no montadas
      refetchOnWindowFocus: false,
      // No ejecutar polling (refetchInterval) cuando la app está en background.
      // Afecta automáticamente a todas las queries con refetchInterval definido.
      refetchIntervalInBackground: false,
      retry: 1,
    },
  },
});
