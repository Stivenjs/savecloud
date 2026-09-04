import { Card, CardBody, CardHeader, Skeleton } from "@heroui/react";

/**
 * Skeleton para la pestaña "Fuentes y descargas".
 * Replica exactamente la estructura de ProxySettingsCard y SourceInstallSettingsCard.
 */
export function SourcesTabSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* ProxySettingsCard Skeleton */}
      <Card className="shadow-sm border border-default-200/60">
        <CardBody className="gap-5 p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-36 rounded-md" />
              <Skeleton className="h-3 w-64 rounded-md" />
            </div>
          </div>
          <div className="h-px bg-default-100" />
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-24 rounded-md" />
              <Skeleton className="h-9 w-full rounded-xl" />
              <Skeleton className="h-2.5 w-48 rounded-md" />
            </div>
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </CardBody>
      </Card>

      {/* SourceInstallSettingsCard Skeleton */}
      <Card className="shadow-sm border border-default-200/60">
        <CardBody className="gap-5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1">
              <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-44 rounded-md" />
                <Skeleton className="h-3 w-72 rounded-md" />
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3 w-14 rounded-md" />
            </div>
          </div>
          <div className="h-px bg-default-100" />

          {/* Fuentes verificadas */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-36 rounded-md" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <Skeleton key={i} className="h-5 w-16 rounded-md" />
              ))}
            </div>
            <Skeleton className="h-9 w-full rounded-xl mt-2" />
          </div>

          <div className="h-px bg-default-100" />

          {/* Lista de fuentes / catálogos importados */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-40 rounded-md" />
              <Skeleton className="h-7 w-28 rounded-lg" />
            </div>
            <div className="overflow-hidden rounded-xl border border-default-200 bg-default-50 divide-y divide-default-100">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-7 w-7 rounded-lg shrink-0" />
                    <div className="space-y-1">
                      <Skeleton className="h-3.5 w-32 rounded-md" />
                      <Skeleton className="h-2.5 w-48 rounded-md" />
                    </div>
                  </div>
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * Skeleton para la pestaña "Integraciones".
 * Replica exactamente AudioOutputSettingsCard, NotificationsCard, VoiceCommandsCard y EmulatorIntegrationsCard.
 */
export function IntegrationsTabSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* AudioOutputSettingsCard Skeleton */}
      <Card className="shadow-sm border border-default-200/60">
        <CardBody className="gap-4 p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-44 rounded-md" />
              <Skeleton className="h-3 w-72 rounded-md" />
            </div>
          </div>
          <Skeleton className="h-9 w-full rounded-xl" />
        </CardBody>
      </Card>

      {/* NotificationsCard Skeleton */}
      <Card className="shadow-sm border border-default-200/60">
        <CardBody className="gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-3 flex-1">
              <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-40 rounded-md" />
                <Skeleton className="h-3 w-64 rounded-md" />
              </div>
            </div>
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </CardBody>
      </Card>

      {/* VoiceCommandsCard Skeleton */}
      <Card className="shadow-sm border border-default-200/60">
        <CardBody className="gap-4 p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-44 rounded-md" />
              <Skeleton className="h-3 w-64 rounded-md" />
            </div>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-default-50 border border-default-200/60">
            <Skeleton className="h-4 w-32 rounded-md" />
            <Skeleton className="h-6 w-11 rounded-full" />
          </div>
        </CardBody>
      </Card>

      {/* EmulatorIntegrationsCard Skeleton */}
      <Card className="shadow-sm border border-default-200/60">
        <CardBody className="gap-4 p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-48 rounded-md" />
              <Skeleton className="h-3 w-80 rounded-md" />
            </div>
          </div>
          <div className="space-y-2 pt-1">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 rounded-xl bg-default-50/70 border border-default-200/50">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <div className="space-y-1">
                    <Skeleton className="h-3.5 w-28 rounded-md" />
                    <Skeleton className="h-2.5 w-44 rounded-md" />
                  </div>
                </div>
                <Skeleton className="h-7 w-20 rounded-lg" />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * Skeleton para la pestaña "Nube".
 * Replica GameInventorySettingsCard, resumen KPI de 3 columnas y tabla de partidas en la nube.
 */
export function CloudTabSkeleton() {
  return (
    <div className="flex min-h-0 flex-col gap-4 animate-pulse">
      {/* GameInventorySettingsCard Skeleton */}
      <Card className="border border-default-200/70 shadow-sm">
        <CardBody className="gap-4 p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-48 rounded-md" />
              <Skeleton className="h-3 w-80 rounded-md" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-default-200 bg-default-100/50 px-3 py-2.5">
            <div className="space-y-1">
              <Skeleton className="h-3.5 w-44 rounded-md" />
              <Skeleton className="h-3 w-64 rounded-md" />
            </div>
            <Skeleton className="h-6 w-11 rounded-full" />
          </div>
        </CardBody>
      </Card>

      {/* Subtitle y botón de actualización */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-4 w-60 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>

      {/* Caja KPI de 3 columnas (juegos, tamaño total, última sync) */}
      <div className="w-full overflow-hidden rounded-xl border border-default-200/70 bg-content1 shadow-sm">
        <div className="grid grid-cols-1 divide-y divide-default-200/80 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1.5 px-4 py-3.5">
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-3.5 w-3.5 rounded" />
                <Skeleton className="h-3 w-20 rounded-md" />
              </div>
              <Skeleton className="h-7 w-24 rounded-md" />
              <Skeleton className="h-3 w-32 rounded-md" />
            </div>
          ))}
        </div>
      </div>

      {/* Tabla de partidas cloud */}
      <div className="rounded-xl border border-default-200/70 bg-content1 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 bg-default-100/40 border-b border-default-200/70">
          <Skeleton className="h-3.5 w-24 rounded" />
          <Skeleton className="h-3.5 w-20 rounded" />
          <Skeleton className="h-3.5 w-20 rounded" />
          <Skeleton className="h-3.5 w-20 rounded" />
          <Skeleton className="h-3.5 w-16 rounded" />
        </div>
        <div className="divide-y divide-default-100">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3 flex-1">
                <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                <div className="space-y-1">
                  <Skeleton className="h-3.5 w-36 rounded-md" />
                  <Skeleton className="h-2.5 w-24 rounded-md" />
                </div>
              </div>
              <Skeleton className="h-3 w-16 rounded-md mx-4" />
              <Skeleton className="h-3 w-12 rounded-md mx-4" />
              <Skeleton className="h-3 w-20 rounded-md mx-4" />
              <Skeleton className="h-7 w-20 rounded-lg shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton para la pestaña "Plugins".
 * Replica exactamente PluginsSettingsSection con su header card, barra de búsqueda y grid de plugins.
 */
export function PluginsTabSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Header Card con gradiente y acciones */}
      <Card className="p-3 border border-default-200/60 bg-linear-to-br from-default-100/70 to-default-50/30">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-32 rounded-md" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
              <Skeleton className="h-3 w-64 rounded-md" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-28 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </CardHeader>
        <CardBody className="pt-2 pb-1 border-t border-default-200/40">
          <div className="flex items-center gap-4 pt-1">
            <Skeleton className="h-3 w-20 rounded-md" />
            <Skeleton className="h-3 w-16 rounded-md" />
            <Skeleton className="h-3 w-24 rounded-md" />
          </div>
        </CardBody>
      </Card>

      {/* Buscador */}
      <Skeleton className="h-10 w-full rounded-xl" />

      {/* Grid de 4 tarjetas de plugins */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4 space-y-3 border border-default-200/60 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-2.5">
                <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-28 rounded-md" />
                    <Skeleton className="h-4 w-12 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-20 rounded-md" />
                </div>
              </div>
              <Skeleton className="h-6 w-11 rounded-full" />
            </div>
            <Skeleton className="h-12 w-full rounded-lg" />
            <div className="flex items-center justify-between pt-1 border-t border-default-100">
              <Skeleton className="h-3 w-24 rounded-md" />
              <div className="flex gap-1">
                <Skeleton className="h-7 w-7 rounded-md" />
                <Skeleton className="h-7 w-7 rounded-md" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton para HealthObservabilityCard en "Avanzado".
 * Replica exactamente la tarjeta de métricas con header, selector temporal y celdas KPI.
 */
export function ObservabilityCardSkeleton() {
  return (
    <Card className="border border-default-200/60 shadow-sm animate-pulse">
      <CardBody className="gap-0 p-0">
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-medium" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-44 rounded-md" />
              <Skeleton className="h-3 w-64 rounded-md" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-7 rounded-lg" />
          </div>
        </header>

        <div className="border-t border-default-200" />

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-medium bg-default-200/60 sm:grid-cols-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-content1/80 p-3 space-y-1.5">
                <Skeleton className="h-3 w-16 rounded" />
                <Skeleton className="h-6 w-20 rounded-md" />
              </div>
            ))}
          </div>
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-28 w-full rounded-md" />
        </div>
      </CardBody>
    </Card>
  );
}
