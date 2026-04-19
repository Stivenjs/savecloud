import { Skeleton } from "@heroui/react";

export function SteamCatalogTrendingHeroSkeleton() {
  return (
    <section className="space-y-3" aria-label="Destacados cargando">
      <div className="relative">
        <div className="overflow-hidden rounded-2xl border border-default-200/70 bg-content1 shadow-sm dark:border-default-100/15">
          <div className="grid min-h-80 grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
            <div className="relative min-h-72 overflow-hidden">
              <Skeleton className="absolute inset-0" />
              <div className="absolute inset-0 bg-linear-to-r from-zinc-950/30 via-zinc-900/10 to-transparent" />
              <div className="relative z-10 flex h-full flex-col justify-between p-5 sm:p-6">
                <Skeleton className="h-4 w-24 rounded" />
                <div className="space-y-3">
                  <Skeleton className="h-12 w-2/3 rounded-lg" />
                  <Skeleton className="h-9 w-24 rounded-lg" />
                </div>
              </div>
            </div>

            <div className="border-t border-default-200/80 bg-[radial-gradient(circle_at_top,#0f2a4b_0%,#0b1a2d_42%,#0a1422_100%)] p-4 lg:border-l lg:border-t-0 lg:border-default-100/15">
              <div className="space-y-3">
                <Skeleton className="h-10 w-2/3 rounded-lg" />
                <Skeleton className="h-10 w-1/2 rounded-lg" />
                <Skeleton className="h-5 w-5/6 rounded" />

                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-20 w-full rounded-sm" />
                  <Skeleton className="h-20 w-full rounded-sm" />
                  <Skeleton className="h-20 w-full rounded-sm" />
                  <Skeleton className="h-20 w-full rounded-sm" />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Skeleton className="h-6 w-14 rounded" />
                  <Skeleton className="h-6 w-16 rounded" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-center gap-1.5">
          <Skeleton className="h-2 w-3 rounded-sm" />
          <Skeleton className="h-2 w-5 rounded-sm" />
          <Skeleton className="h-2 w-3 rounded-sm" />
          <Skeleton className="h-2 w-3 rounded-sm" />
          <Skeleton className="h-2 w-3 rounded-sm" />
        </div>
      </div>
    </section>
  );
}
