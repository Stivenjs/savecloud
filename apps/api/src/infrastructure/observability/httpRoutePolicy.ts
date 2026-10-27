/**
 * Rutas auxiliares que no deben aparecer como tráfico de API en logs ni métricas.
 * Se normaliza la query para que, por ejemplo, `/health?check=1` también se ignore.
 */
export function shouldIgnoreHttpObservation(path: string): boolean {
  const pathname = path.split("?")[0] ?? "";

  return (
    pathname === "/" || pathname === "/health" || pathname === "/favicon.ico" || pathname.startsWith("/observability/")
  );
}
