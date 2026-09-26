import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { Modal, ModalContent, Kbd, Spinner } from "@heroui/react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLibrary } from "@hooks/useLibrary";
import { searchSteamCatalog, type CatalogListItem } from "@services/tauri";
import { CommandPaletteResults } from "./command-palette/CommandPaletteResults";
import { useCommandPaletteCommands } from "./command-palette/useCommandPaletteCommands";

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPaletteModal({ isOpen, onClose }: CommandPaletteModalProps) {
  const { t } = useTranslation();
  const { games } = useLibrary();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [catalogResults, setCatalogResults] = useState<CatalogListItem[]>([]);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const commands = useCommandPaletteCommands({ games, catalogResults, query: deferredQuery, onClose });

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setCatalogResults([]);
      return;
    }

    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [isOpen]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      setCatalogResults([]);
      setIsCatalogLoading(false);
      return;
    }

    let isActive = true;
    setIsCatalogLoading(true);
    const searchTimer = setTimeout(async () => {
      try {
        const results = await searchSteamCatalog(trimmedQuery, 4);
        if (isActive) setCatalogResults(results || []);
      } catch {
        if (isActive) setCatalogResults([]);
      } finally {
        if (isActive) setIsCatalogLoading(false);
      }
    }, 200);

    return () => {
      isActive = false;
      clearTimeout(searchTimer);
    };
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [deferredQuery, catalogResults]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (commands.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((previous) => (previous + 1) % commands.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((previous) => (previous - 1 + commands.length) % commands.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        commands[selectedIndex]?.action();
      }
    },
    [commands, selectedIndex]
  );

  const resetKey = `${deferredQuery}:${catalogResults.map((item) => item.steamAppId).join(",")}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      hideCloseButton
      size="2xl"
      backdrop="blur"
      motionProps={{
        variants: {
          enter: {
            y: 0,
            opacity: 1,
            scale: 1,
            transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
          },
          exit: {
            y: -10,
            opacity: 0,
            scale: 0.98,
            transition: { duration: 0.12, ease: "easeIn" },
          },
        },
      }}
      classNames={{
        wrapper: "z-[9999] items-start pt-20",
        base: "bg-content1 border border-default-200/80 shadow-2xl rounded-2xl overflow-hidden p-0 transform-gpu",
      }}>
      <ModalContent>
        <div onKeyDown={handleKeyDown} className="flex flex-col w-full">
          <div className="flex items-center px-4 py-3.5 border-b border-default-200/80 bg-default-100/50 gap-3">
            {isCatalogLoading ? (
              <Spinner size="sm" color="primary" className="shrink-0" />
            ) : (
              <Search className="w-4 h-4 text-primary shrink-0" strokeWidth={2} />
            )}
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("commandPalette.placeholder", "Buscar en biblioteca y catálogo Steam... (Ctrl + K)")}
              className="w-full bg-transparent text-foreground placeholder-default-400 text-sm font-medium focus:outline-none"
            />
            <Kbd
              keys={["command"]}
              className="hidden sm:inline-flex bg-default-200/80 text-default-500 text-[10px] border border-default-300/50">
              K
            </Kbd>
          </div>

          <CommandPaletteResults
            commands={commands}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            query={query}
            resetKey={resetKey}
          />

          <div className="px-4 py-2.5 border-t border-default-200/80 bg-default-100/50 flex items-center justify-between text-[11px] text-default-500">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">↑</Kbd>
                <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">↓</Kbd>{" "}
                {t("commandPalette.navigateShortcut", "Navegar")}
              </span>
              <span className="flex items-center gap-1">
                <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">↵</Kbd>{" "}
                {t("commandPalette.openShortcut", "Abrir")}
              </span>
            </div>
            <span className="flex items-center gap-1">
              <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">ESC</Kbd>{" "}
              {t("commandPalette.closeShortcut", "Cerrar")}
            </span>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
