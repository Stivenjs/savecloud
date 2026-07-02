import { useTranslation } from "react-i18next";
import { StreamingPanel } from "@components/streaming/StreamingPanel";

export default function RemotePlayPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6 p-6 h-full overflow-y-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">{t("remotePlay.pageTitle")}</h1>
        <p className="text-default-500">{t("remotePlay.pageDesc")}</p>
      </div>
      <div className="flex-1 max-w-4xl">
        <StreamingPanel />
      </div>
    </div>
  );
}
