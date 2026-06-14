import { StreamingPanel } from "@components/streaming/StreamingPanel";

export default function RemotePlayPage() {
  return (
    <div className="flex flex-col gap-6 p-6 h-full overflow-y-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Remote Play</h1>
        <p className="text-default-500">Juega y comparte partidas en tu red local</p>
      </div>
      <div className="flex-1 max-w-4xl">
        <StreamingPanel />
      </div>
    </div>
  );
}
