import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppLayout, SyncProgressBar } from "@components/layout";
import { SyncProgressProvider } from "@contexts/SyncProgressContext";
import { NAV_ITEMS, PageContent, pageTransition } from "@components/navigation/PageContent";
import { TrayActionsListener } from "@components/sync/TrayActionsListener";
import { UnsyncedSavesModalWithProgress } from "@features/games";
import { useAppInitialization } from "@hooks/useAppInitialization";
import { useGlobalInput } from "@features/input/useGlobalInput";
import { useFocusable, FocusContext } from "@noriginmedia/norigin-spatial-navigation";
import "./App.css";

function InputEngine() {
  useGlobalInput();
  return null;
}

function RootFocusProvider({ children }: { children: React.ReactNode }) {
  const { ref, focusKey } = useFocusable({
    focusKey: "ROOT",
    trackChildren: true,
    autoRestoreFocus: true,
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="w-full h-full">
        {children}
      </div>
    </FocusContext.Provider>
  );
}

function App() {
  const [activeNavId, setActiveNavId] = useState("games");

  useAppInitialization();

  return (
    <>
      <InputEngine />

      <SyncProgressProvider>
        <TrayActionsListener />
        <UnsyncedSavesModalWithProgress />
        <RootFocusProvider>
          <AppLayout navItems={NAV_ITEMS} activeNavId={activeNavId} onNavSelect={setActiveNavId}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeNavId}
                initial={pageTransition.initial}
                animate={pageTransition.animate}
                exit={pageTransition.exit}
                transition={pageTransition.transition}
                className="min-h-[50vh]">
                <PageContent activeId={activeNavId} />
              </motion.div>
            </AnimatePresence>
          </AppLayout>
        </RootFocusProvider>
        <SyncProgressBar />
      </SyncProgressProvider>
    </>
  );
}

export default App;
