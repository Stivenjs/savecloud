import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Chip,
  ScrollShadow,
  Divider,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Accordion,
  AccordionItem,
} from "@heroui/react";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, useRef } from "react";
import { Trash2 } from "lucide-react";
import { getPluginLogs, PluginLogEntry } from "@/services/tauri/config.service";

interface PluginLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function cleanMessage(message: string): string {
  return message.replace(/^[^:]+:\d+(:\d+)?:\s*/, "");
}

function MessageWithAccordion({ entry }: { entry: PluginLogEntry }) {
  const message = entry.level === "error" ? cleanMessage(entry.message) : entry.message;
  const isLong = message.length > 80;

  if (!isLong) {
    return (
      <span
        className={`break-all ${
          entry.level === "error" ? "text-danger-600 dark:text-danger-400" : "text-default-700 dark:text-default-300"
        }`}>
        {message}
      </span>
    );
  }

  const preview = message.slice(0, 80) + "…";

  return (
    <Accordion
      isCompact
      className="p-0"
      itemClasses={{
        base: "p-0",
        heading: "p-0",
        trigger: "p-0 gap-1",
        content: "pt-1 pb-0",
        title: "font-mono text-xs",
      }}>
      <AccordionItem
        key="msg"
        aria-label="Ver mensaje completo"
        title={
          <span
            className={`break-all ${
              entry.level === "error"
                ? "text-danger-600 dark:text-danger-400"
                : "text-default-700 dark:text-default-300"
            }`}>
            {preview}
          </span>
        }>
        <span
          className={`break-all whitespace-pre-wrap ${
            entry.level === "error" ? "text-danger-600 dark:text-danger-400" : "text-default-700 dark:text-default-300"
          }`}>
          {message}
        </span>
      </AccordionItem>
    </Accordion>
  );
}

export function PluginLogsModal({ isOpen, onClose }: PluginLogsModalProps) {
  const [logs, setLogs] = useState<PluginLogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    getPluginLogs().then(setLogs).catch(console.error);

    const unlisten = listen<PluginLogEntry>("plugin_log", (event) => {
      setLogs((prev) => [...prev, event.payload]);
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleClear = () => setLogs([]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="3xl"
      scrollBehavior="inside"
      classNames={{
        base: "max-h-[80vh]",
        body: "p-0",
      }}>
      <ModalContent>
        <ModalHeader className="flex items-center justify-between pr-10">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">Logs de plugins</span>
            {logs.length > 0 && (
              <Chip size="sm" variant="flat" color="default">
                {logs.length}
              </Chip>
            )}
          </div>
        </ModalHeader>

        <Divider />

        <ModalBody>
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-default-400">
              <span className="text-sm">No hay logs todavía</span>
              <span className="text-xs text-default-300">Los mensajes de tus plugins aparecerán aquí</span>
            </div>
          ) : (
            <ScrollShadow className="h-[480px]">
              <Table
                removeWrapper
                isStriped
                aria-label="Logs de plugins"
                classNames={{
                  th: "text-xs font-medium bg-default-50 first:rounded-none last:rounded-none",
                  td: "font-mono text-xs py-1.5 align-top",
                }}>
                <TableHeader>
                  <TableColumn width={70}>Hora</TableColumn>
                  <TableColumn width={60}>Nivel</TableColumn>
                  <TableColumn width={110}>Plugin</TableColumn>
                  <TableColumn>Mensaje</TableColumn>
                </TableHeader>
                <TableBody>
                  {logs.map((entry, i) => (
                    <TableRow
                      key={i}
                      className={entry.level === "error" ? "bg-danger-50/40 dark:bg-danger-900/10" : ""}>
                      <TableCell className="text-default-400 whitespace-nowrap">{entry.timestamp}</TableCell>
                      <TableCell>
                        <Chip
                          size="sm"
                          variant="flat"
                          color={entry.level === "error" ? "danger" : "success"}
                          classNames={{
                            base: "h-5 min-w-12",
                            content: "text-[10px] px-1.5",
                          }}>
                          {entry.level}
                        </Chip>
                      </TableCell>
                      <TableCell className="text-primary-400 whitespace-nowrap">{entry.plugin}</TableCell>
                      <TableCell>
                        <MessageWithAccordion entry={entry} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div ref={bottomRef} />
            </ScrollShadow>
          )}
        </ModalBody>

        <Divider />

        <ModalFooter className="flex justify-between">
          <Button
            size="sm"
            variant="light"
            color="danger"
            startContent={<Trash2 size={14} />}
            onPress={handleClear}
            isDisabled={logs.length === 0}>
            Limpiar
          </Button>
          <Button size="sm" variant="flat" onPress={onClose}>
            Cerrar
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
