import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Spinner } from "@heroui/react";
import { LogOut } from "lucide-react";

/**
 * Solo informativa. El tray programa el cierre en Rust; avisamos cuando React montó
 * para que el proceso espere al primer frame (WebView2 / hilo principal).
 */
export function ShutdownWindowPage() {
  useEffect(() => {
    void invoke("shutdown_splash_mounted").catch(() => {});
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-br from-background via-default-50/55 to-default-100/80 dark:from-default-200/10 dark:via-default-100/5 dark:to-background"
      />
      <div className="pointer-events-none absolute inset-0 backdrop-blur-sm" aria-hidden />

      <div className="relative flex h-full flex-col items-center justify-center px-8 py-10">
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-default-200/60 bg-content1/95 px-8 py-10 text-center shadow-sm backdrop-blur-md dark:border-default-100/15 dark:bg-content1/85">
          <div className="flex flex-col items-center gap-2" aria-hidden>
            <Spinner size="lg" color="primary" aria-label="Cerrando" />
            <LogOut className="size-5 text-primary/80" strokeWidth={1.75} />
          </div>
          <h1 className="text-base font-semibold leading-snug text-foreground sm:text-[1.0625rem]">
            Saliendo de SaveCloud…
          </h1>
          <p className="max-w-[40ch] text-sm leading-relaxed text-default-600 dark:text-default-400">
            La aplicación se está cerrando de forma ordenada. No hace falta hacer nada más.
          </p>
        </div>
      </div>
    </div>
  );
}
