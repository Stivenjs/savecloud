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
  avatar?: string;
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

/** Configuración de animación - estilo Steam: slide desde la derecha */
const ANIMATION_CONFIG: {
  initial: { opacity: number; x: number };
  animate: { opacity: number; x: number };
  exit: { opacity: number; x: number };
  transition: Transition;
} = {
  initial: { opacity: 0, x: 320 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 320 },
  transition: { type: "tween", duration: 0.3, ease: [0.4, 0, 0.2, 1] },
} as const;

const NotificationCard: React.FC<OverlayNotification> = ({ id, title, body, avatar }) => (
  <motion.div key={id} {...ANIMATION_CONFIG} className="pointer-events-auto">
    {/* Contenedor principal */}
    <div className="flex bg-[#1a1a1a] rounded-[4px] overflow-hidden shadow-[0_3px_12px_rgba(0,0,0,0.55)]">
      {/* Barra verde lateral */}
      <div className="w-[4px] bg-[#5c7e10] shrink-0" />

      {/* Contenido de la notificación */}
      <div className="flex items-center gap-[12px] py-[12px] px-[14px]">
        {/* Avatar cuadrado con esquinas ligeramente redondeadas */}
        <div className="w-[36px] h-[36px] rounded-[3px] bg-[#3d3d3d] overflow-hidden shrink-0 flex items-center justify-center">
          {avatar ? (
            <img src={avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <Gamepad2 className="w-[20px] h-[20px] text-[#67707b]" />
          )}
        </div>

        {/* Texto */}
        <div className="flex flex-col min-w-0">
          {/* Nombre del amigo */}
          <span className="text-[#c6d4df] text-[14px] font-normal leading-[1.2] truncate max-w-[220px]">{title}</span>
          {/* Estado */}
          <span className="text-[#5c7e10] text-[13px] font-normal leading-[1.3] truncate max-w-[220px]">{body}</span>
        </div>
      </div>
    </div>
  </motion.div>
);

/**
 * Hook para gestionar las notificaciones del overlay
 *
 * @returns Estado y funciones para manejar notificaciones
 */
function useOverlayNotifications() {
  const [notifications, setNotifications] = useState<OverlayNotification[]>([]);
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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
      console.info("[OverlayApp] Setting up 'show-overlay-notification' listener...");
      try {
        unlisten = await listen<NotificationPayload>("show-overlay-notification", (event) => {
          console.info("[OverlayApp] Received 'show-overlay-notification' event:", event.payload);
          const { title, body } = event.payload;

          if (!title?.trim() || !body?.trim()) {
            console.warn("[Overlay] Notificación recibida con datos inválidos:", event.payload);
            return;
          }

          addNotification({ title, body });
          console.info("[OverlayApp] Notification added to list");
        });
        console.info("[OverlayApp] Listener is active");
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
        className="absolute bottom-4 right-4 flex flex-col items-end gap-2 pointer-events-none"
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
