import { useEffect, useState, useCallback, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import { Gamepad2 } from "lucide-react";

/**
 * Payload recibido del evento de notificación
 */
interface NotificationPayload {
  title: string;
  body: string;
}

/**
 * Notificación del overlay con identificador único
 */
interface OverlayNotification extends NotificationPayload {
  id: string;
}

/** Duración de la notificación en pantalla (ms) */
const NOTIFICATION_DURATION = 5000;

/** Número máximo de notificaciones simultáneas */
const MAX_NOTIFICATIONS = 5;

/** Configuración de animación de las notificaciones */
const ANIMATION_CONFIG: {
  initial: { opacity: number; x: number; y: number };
  animate: { opacity: number; x: number; y: number };
  exit: { opacity: number; x: number; scale: number };
  transition: Transition;
} = {
  initial: { opacity: 0, x: 50, y: 20 },
  animate: { opacity: 1, x: 0, y: 0 },
  exit: { opacity: 0, x: 50, scale: 0.95 },
  transition: { type: "spring", stiffness: 300, damping: 25 },
} as const;

/**
 * Componente de ícono de notificación
 */
const NotificationIcon: React.FC = () => (
  <div className="w-12 h-12 rounded-full bg-[#1b80db]/20 flex items-center justify-center shrink-0">
    <Gamepad2 className="w-6 h-6 text-[#1b80db]" />
  </div>
);

/**
 * Componente de contenido de notificación
 */
const NotificationContent: React.FC<NotificationPayload> = ({ title, body }) => (
  <div className="flex flex-col flex-1 overflow-hidden">
    <h4 className="text-white font-semibold text-sm m-0 truncate leading-tight tracking-wide">{title}</h4>
    <p className="text-gray-300/80 text-xs m-0 mt-1 truncate">{body}</p>
  </div>
);

/**
 * Componente de tarjeta de notificación individual
 */
const NotificationCard: React.FC<OverlayNotification> = ({ id, title, body }) => (
  <motion.div
    key={id}
    {...ANIMATION_CONFIG}
    className="bg-black/80 backdrop-blur-xl border border-white/15 shadow-2xl rounded-2xl p-4 flex items-center gap-4 w-[340px] pointer-events-auto">
    <NotificationIcon />
    <NotificationContent title={title} body={body} />
  </motion.div>
);

/**
 * Hook para gestionar las notificaciones del overlay
 *
 * @returns Estado y funciones para manejar notificaciones
 */
function useOverlayNotifications() {
  const [notifications, setNotifications] = useState<OverlayNotification[]>([]);
  const timeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  /**
   * Agrega una nueva notificación y programa su eliminación automática
   */
  const addNotification = useCallback((payload: NotificationPayload) => {
    const id = window.crypto.randomUUID();
    const notification: OverlayNotification = { id, ...payload };

    setNotifications((prev) => {
      // Limitar número de notificaciones simultáneas
      const updated = [...prev, notification];
      if (updated.length > MAX_NOTIFICATIONS) {
        const removed = updated.shift();
        if (removed) {
          // Limpiar timeout de la notificación eliminada
          const timeout = timeoutsRef.current.get(removed.id);
          if (timeout) {
            clearTimeout(timeout);
            timeoutsRef.current.delete(removed.id);
          }
        }
      }
      return updated;
    });

    // Programar eliminación automática
    const timeout = setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      timeoutsRef.current.delete(id);
    }, NOTIFICATION_DURATION);

    timeoutsRef.current.set(id, timeout);
  }, []);

  /**
   * Limpia todos los timeouts pendientes
   */
  const cleanup = useCallback(() => {
    timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    timeoutsRef.current.clear();
  }, []);

  return { notifications, addNotification, cleanup };
}

/**
 * Aplicación de overlay para mostrar notificaciones sobre juegos
 *
 * Características:
 * - Renderiza notificaciones en la esquina inferior derecha
 * - Animaciones de entrada/salida suaves
 * - Auto-eliminación después de 5 segundos
 * - Límite de notificaciones simultáneas
 * - Transparente al mouse (pointer-events-none) excepto las notificaciones
 *
 * @example
 * // En modo overlay, la aplicación escucha eventos y muestra notificaciones
 * <OverlayApp />
 */
export function OverlayApp() {
  const { notifications, addNotification, cleanup } = useOverlayNotifications();

  // Emitir señal de que el overlay está listo
  useEffect(() => {
    const signalReady = async () => {
      try {
        await emit("overlay-ready");
      } catch (error) {
        console.error("[Overlay] Error emitiendo señal de ready:", error);
      }
    };

    signalReady();
  }, []);

  // Escuchar eventos de notificación
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<NotificationPayload>("show-overlay-notification", (event) => {
          const { title, body } = event.payload;

          if (!title?.trim() || !body?.trim()) {
            console.warn("[Overlay] Notificación recibida con datos inválidos:", event.payload);
            return;
          }

          addNotification({ title, body });
        });
      } catch (error) {
        console.error("[Overlay] Error configurando listener de notificaciones:", error);
      }
    };

    setupListener();

    return () => {
      unlisten?.();
      cleanup();
    };
  }, [addNotification, cleanup]);

  return (
    <div className="fixed inset-0 m-0 p-0 pointer-events-none bg-transparent overflow-hidden">
      {/* Contenedor de notificaciones - esquina inferior derecha */}
      <div
        className="absolute bottom-10 right-10 flex flex-col items-end gap-3 pointer-events-none"
        role="region"
        aria-label="Notificaciones de overlay"
        aria-live="polite">
        <AnimatePresence mode="popLayout">
          {notifications.map((notification) => (
            <NotificationCard key={notification.id} {...notification} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
