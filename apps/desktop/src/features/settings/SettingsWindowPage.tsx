import { SettingsPage } from "@features/settings/SettingsPage";
import { TitleBar } from "@components/layout/TitleBar";

export function SettingsWindowPage() {
  return (
    <div className="min-h-screen bg-background">
      <TitleBar />
      <div className="h-screen overflow-hidden px-3 pb-3 pt-12">
        <SettingsPage compactWindowMode />
      </div>
    </div>
  );
}
