import { Button, Card, CardBody, Chip } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getSteamSeedWorkerControl, setSteamSeedWorkerPaused } from "@services/tauri";
import { toastError, toastSuccess } from "@utils/toast";

const workerControlQueryKey = ["steam-seed-worker-control"] as const;

export function SteamSeedWorkerControls() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const controlQuery = useQuery({
    queryKey: workerControlQueryKey,
    queryFn: getSteamSeedWorkerControl,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const controlMutation = useMutation({
    mutationFn: setSteamSeedWorkerPaused,
    onSuccess: (control) => {
      queryClient.setQueryData(workerControlQueryKey, control);
      toastSuccess(
        control.paused ? t("settings.configSection.workerPaused") : t("settings.configSection.workerResumed")
      );
    },
    onError: (error) => {
      toastError(error instanceof Error ? error.message : t("settings.configSection.workerControlError"));
    },
  });

  if (!controlQuery.data && !controlQuery.isError) return null;
  if (controlQuery.data === null) return null;

  const control = controlQuery.data;
  if (!control) {
    return (
      <p role="status" className="text-xs text-danger">
        {t("settings.configSection.workerControlLoadError")}
      </p>
    );
  }

  return (
    <Card className="border border-default-200/70 bg-default-50/40 dark:border-default-100/15 dark:bg-default-100/5">
      <CardBody className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{t("settings.configSection.workerTitle")}</p>
            <Chip size="sm" color={control.paused ? "warning" : "success"} variant="flat">
              {control.paused
                ? t("settings.configSection.workerStatusPaused")
                : t("settings.configSection.workerStatusEnabled")}
            </Chip>
          </div>
          <p className="text-xs text-default-500">
            {control.catalogComplete
              ? t("settings.configSection.workerCatalogComplete", { batches: control.batchSeq })
              : t("settings.configSection.workerProgress", { batches: control.batchSeq })}
          </p>
          {control.lastBatchKey ? (
            <p className="max-w-xl truncate text-xs text-default-400" title={control.lastBatchKey}>
              {t("settings.configSection.workerLastBatch", { key: control.lastBatchKey })}
            </p>
          ) : null}
          <p className="text-xs text-default-500">
            {t("settings.configSection.workerReviewsProgress", {
              batches: control.reviews.batchSeq,
              processed: control.reviews.processed,
              ok: control.reviews.ok,
              notFound: control.reviews.notFound,
              errors: control.reviews.httpErrors,
            })}
          </p>
          {control.reviews.lastBatchKey ? (
            <p className="max-w-xl truncate text-xs text-default-400" title={control.reviews.lastBatchKey}>
              {t("settings.configSection.workerReviewsLastBatch", { key: control.reviews.lastBatchKey })}
            </p>
          ) : null}
          {control.updatedAt ? (
            <p className="text-xs text-default-400">
              {t("settings.configSection.workerUpdated", {
                date: new Date(control.updatedAt).toLocaleString(),
              })}
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          color={control.paused ? "success" : "warning"}
          variant="flat"
          isLoading={controlMutation.isPending}
          isDisabled={controlQuery.isFetching || controlMutation.isPending}
          startContent={control.paused ? <Play size={15} /> : <Pause size={15} />}
          onPress={() => controlMutation.mutate(!control.paused)}>
          {control.paused ? t("settings.configSection.workerResume") : t("settings.configSection.workerPause")}
        </Button>
      </CardBody>
    </Card>
  );
}
