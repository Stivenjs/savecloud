import { Card, Skeleton } from "@heroui/react";

/**
 * Skeleton para la pantalla principal de la biblioteca (GamesPage).
 * Replica con exactitud milimétrica la cuadrícula, cabecera unificada,
 * buscador con debounce, selector de origen y tarjetas de juegos en vertical (aspect 2:3).
 */
export function GamesPageSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      {/* Encabezado: Título + Botones unificados */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <Skeleton className="h-9 w-60 rounded-xl" />
          </div>
          <div className="flex w-full min-w-0 max-w-full justify-start pr-2">
            <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
              <Skeleton className="h-10 w-36 rounded-lg" />
              <Skeleton className="h-10 w-10 rounded-lg" />
              <Skeleton className="h-10 w-10 rounded-lg" />
              <Skeleton className="h-10 w-10 rounded-lg" />
            </div>
          </div>
        </div>
      </div>

      {/* Sección de Filtros y Búsqueda */}
      <div className="flex flex-col gap-6 mt-6 sm:mt-8">
        <section className="space-y-2">
          <Skeleton className="h-4 w-36 rounded-md" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-10 w-full sm:max-w-xs rounded-xl" />
            <div className="inline-flex w-fit max-w-full items-center gap-1 rounded-xl border border-default-200/70 bg-default-100/30 p-1">
              <Skeleton className="h-10 w-16 rounded-lg" />
              <Skeleton className="h-10 w-20 rounded-lg" />
              <Skeleton className="h-10 w-16 rounded-lg" />
            </div>
          </div>
        </section>

        {/* Sección de Lista de Juegos */}
        <section className="space-y-2">
          <Skeleton className="h-4 w-20 rounded-md" />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <Card
                key={i}
                className="overflow-hidden border border-default-200/70 bg-content1 shadow-sm rounded-2xl dark:border-default-100/20">
                {/* Poster vertical 2:3 */}
                <Skeleton className="aspect-2/3 w-full rounded-b-none" />
                <div className="p-3.5 space-y-2">
                  <Skeleton className="h-4 w-4/5 rounded-md" />
                  <div className="flex items-center justify-between pt-1">
                    <Skeleton className="h-3 w-16 rounded-md" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
