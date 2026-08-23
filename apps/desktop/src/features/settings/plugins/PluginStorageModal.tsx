import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Chip,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  ScrollShadow,
} from "@heroui/react";
import { Database, Search, Trash2, RefreshCw, Copy, Check } from "lucide-react";
import { type PluginInfo, type PluginStorageEntry } from "@services/tauri";
import { useTranslation } from "react-i18next";
import { usePluginStorage } from "./usePluginStorage";

interface PluginStorageModalProps {
  plugin: PluginInfo | null;
  isOpen: boolean;
  onClose: () => void;
}

export function PluginStorageModal({ plugin, isOpen, onClose }: PluginStorageModalProps) {
  const { t } = useTranslation();
  const {
    entries,
    filteredEntries,
    isLoading,
    filter,
    setFilter,
    copiedKey,
    isConfirmingClear,
    setIsConfirmingClear,
    isClearingPending,
    refetch,
    handleCopy,
    formatDate,
    handleClearStorage,
  } = usePluginStorage(plugin, isOpen);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 pb-2">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-primary" />
            <span className="text-base font-semibold">
              {t("settings.plugins.storage.title", { name: plugin?.name || "" })}
            </span>
            <Chip size="sm" variant="flat" color="primary">
              {t("settings.plugins.storage.keysCount", { count: entries.length })}
            </Chip>
          </div>
          <p className="text-xs text-default-400 font-normal">
            {t("settings.plugins.storage.subtitle", { id: plugin?.id || "" })}
          </p>
        </ModalHeader>

        <ModalBody className="gap-3 pt-1">
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              placeholder={t("settings.plugins.storage.searchPlaceholder")}
              value={filter}
              onValueChange={setFilter}
              startContent={<Search size={14} className="text-default-400" />}
              isClearable
              onClear={() => setFilter("")}
              className="flex-1"
            />
            <Button
              isIconOnly
              size="sm"
              variant="flat"
              onPress={() => refetch()}
              isLoading={isLoading}
              title={t("common.reload")}>
              <RefreshCw size={14} />
            </Button>
          </div>

          <ScrollShadow className="max-h-90 min-h-40">
            {isLoading ? (
              <div className="flex h-36 items-center justify-center text-xs text-default-400">
                {t("common.loading")}
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="flex flex-col h-36 items-center justify-center gap-1.5 text-center text-default-400">
                <Database size={24} className="opacity-40" />
                <p className="text-xs font-medium">
                  {filter ? t("settings.plugins.storage.noFilterMatch") : t("settings.plugins.storage.empty")}
                </p>
              </div>
            ) : (
              <Table aria-label="Claves de almacenamiento del plugin" isCompact removeWrapper className="text-xs">
                <TableHeader>
                  <TableColumn className="w-1/3">{t("settings.plugins.storage.colKey")}</TableColumn>
                  <TableColumn className="w-1/2">{t("settings.plugins.storage.colValue")}</TableColumn>
                  <TableColumn className="w-1/6 text-right">{t("settings.plugins.storage.colDate")}</TableColumn>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((item: PluginStorageEntry) => (
                    <TableRow key={item.key} className="border-b border-default-100">
                      <TableCell className="font-mono font-medium text-default-700 dark:text-default-200">
                        {item.key}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-between gap-1 group">
                          <span className="font-mono text-default-500 truncate max-w-55" title={item.value}>
                            {item.value}
                          </span>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onPress={() => handleCopy(item.value, item.key)}
                            title={t("common.copy", "Copiar")}>
                            {copiedKey === item.key ? (
                              <Check size={12} className="text-success" />
                            ) : (
                              <Copy size={12} className="text-default-400" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-[10px] text-default-400 whitespace-nowrap">
                        {formatDate(item.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollShadow>
        </ModalBody>

        <ModalFooter className="justify-between">
          <div>
            {entries.length > 0 && !isConfirmingClear ? (
              <Button
                size="sm"
                color="danger"
                variant="flat"
                startContent={<Trash2 size={14} />}
                onPress={() => setIsConfirmingClear(true)}>
                {t("settings.plugins.storage.clearBtn")}
              </Button>
            ) : isConfirmingClear ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-danger font-medium">
                  {t("settings.plugins.storage.confirmClearPrompt")}
                </span>
                <Button size="sm" color="danger" isLoading={isClearingPending} onPress={handleClearStorage}>
                  {t("common.confirm")}
                </Button>
                <Button size="sm" variant="light" onPress={() => setIsConfirmingClear(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            ) : null}
          </div>

          <Button size="sm" variant="flat" onPress={onClose}>
            {t("common.close")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
