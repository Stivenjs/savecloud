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

      <div className="relative flex h-full flex-col items-center justify-center p-8">
        <div className="w-full max-w-md rounded-2xl border border-default-200/60 bg-content1/95 px-8 py-10 shadow-sm backdrop-blur-md dark:border-default-100/15 dark:bg-content1/85">
          <div className="flex flex-col items-center text-center">
            <div
              className="flex size-18 items-center justify-center rounded-full border border-divider bg-content2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:border-default-100/12"
              aria-hidden>
              <Spinner size="lg" color="primary" classNames={{ label: "mt-0" }} aria-label="Cerrando" />
            </div>
            <div className="mt-2 flex items-center justify-center text-primary" aria-hidden>
              <LogOut className="size-6 opacity-80" strokeWidth={1.75} />
            </div>

            <h1 className="mt-5 text-base font-semibold leading-snug text-foreground sm:text-[1.0625rem]">
              Saliendo de SaveCloud…
            </h1>
            <p className="mt-2 max-w-[40ch] text-sm leading-relaxed text-default-600 dark:text-default-400">
              La aplicación se está cerrando de forma ordenada. No hace falta hacer nada más.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
