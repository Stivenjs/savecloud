import { Card, Skeleton } from "@heroui/react";

export function SourcesTabSkeleton() {
  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-36 rounded-md" />
            <Skeleton className="h-3 w-64 rounded-md" />
          </div>
        </div>
        <Skeleton className="h-9 w-full rounded-xl mt-2" />
      </Card>
      <Card className="p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-44 rounded-md" />
            <Skeleton className="h-3 w-72 rounded-md" />
          </div>
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </Card>
    </div>
  );
}

export function IntegrationsTabSkeleton() {
  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded-lg" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-48 rounded-md" />
            <Skeleton className="h-3 w-64 rounded-md" />
          </div>
          <Skeleton className="h-9 w-44 rounded-xl" />
        </div>
      </Card>
      <Card className="p-5 space-y-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded-lg" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-36 rounded-md" />
            <Skeleton className="h-3 w-56 rounded-md" />
          </div>
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </Card>
      <Card className="p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded-lg" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton className="h-3 w-60 rounded-md" />
          </div>
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
      </Card>
      <Card className="p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded-lg" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-44 rounded-md" />
            <Skeleton className="h-3 w-64 rounded-md" />
          </div>
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
      </Card>
    </div>
  );
}
