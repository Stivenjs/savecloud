import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button, Input, Tooltip } from "@heroui/react";
import { Cloud, RefreshCcw, Search, SquareArrowOutUpRight, X } from "lucide-react";

interface CloudMembersHeaderProps {
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onClose: () => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  moveProps?: Record<string, any>;
  onDetachToWindow?: () => void;
  showCloseButton?: boolean;
}

export function CloudMembersHeader({
  isRefreshing,
  onRefresh,
  onClose,
  searchValue,
  onSearchChange,
  moveProps = {},
  onDetachToWindow,
  showCloseButton = true,
}: CloudMembersHeaderProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isSearchOpen) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [isSearchOpen]);

  const handleToggleSearch = () => {
    setIsSearchOpen((value) => {
      const next = !value;
      if (!next) {
        inputRef.current?.blur();
      }
      return next;
    });
  };

  return (
    <div className="flex w-full flex-col gap-2 border-b border-default-200/80 px-3 py-2.5">
      {/* Fila principal: icon + title + actions */}
      <div
        {...moveProps}
        className="flex cursor-grab items-center justify-between gap-2 touch-none active:cursor-grabbing">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-default-100/75 text-default-700">
            <Cloud size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Miembros cloud</p>
            <p className="text-[10px] text-default-500">Red compartida</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip content={isSearchOpen ? "Ocultar búsqueda" : "Buscar"} placement="bottom">
            <Button
              isIconOnly
              size="sm"
              variant="light"
              onPointerDown={(event) => event.preventDefault()}
              onPointerDownCapture={(event) => event.stopPropagation()}
              onPress={handleToggleSearch}>
              <Search className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Actualizar" placement="bottom">
            <Button
              isIconOnly
              size="sm"
              variant="light"
              isLoading={isRefreshing}
              isDisabled={isRefreshing}
              onPointerDownCapture={(event) => event.stopPropagation()}
              onPress={async () => await onRefresh()}>
              {!isRefreshing && <RefreshCcw className="h-4 w-4" />}
            </Button>
          </Tooltip>
          {onDetachToWindow ? (
            <Tooltip content="Abrir en ventana separada" placement="bottom">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPointerDownCapture={(event) => event.stopPropagation()}
                onPress={onDetachToWindow}>
                <SquareArrowOutUpRight className="h-4 w-4" />
              </Button>
            </Tooltip>
          ) : null}
          {showCloseButton ? (
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="danger"
              aria-label="Cerrar modal"
              onPointerDownCapture={(event) => event.stopPropagation()}
              onPress={onClose}>
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <motion.div
        layout
        initial={false}
        animate={{
          height: isSearchOpen ? 40 : 0,
          opacity: isSearchOpen ? 1 : 0,
          y: isSearchOpen ? 0 : -4,
        }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="origin-top overflow-hidden">
        <Input
          ref={inputRef}
          isClearable
          size="sm"
          radius="md"
          placeholder="Buscar miembro..."
          startContent={<Search className="h-4 w-4 text-default-400" />}
          value={searchValue}
          onValueChange={onSearchChange}
          onPointerDownCapture={(event) => event.stopPropagation()}
          classNames={{
            input: "text-sm",
            inputWrapper: "h-8",
          }}
          style={{ pointerEvents: isSearchOpen ? "auto" : "none" }}
        />
      </motion.div>
    </div>
  );
}
