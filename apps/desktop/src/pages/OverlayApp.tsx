import { useEffect, useState, useCallback, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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

/** Delay para ocultar overlay al finalizar animación de salida (ms) */
const OVERLAY_HIDE_DELAY = 350;

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
    <div className="flex bg-[#1a1a1a] rounded-sm overflow-hidden shadow-[0_3px_12px_rgba(0,0,0,0.55)]">
      {/* Barra verde lateral */}
      <div className="w-1 bg-[#5c7e10] shrink-0" />

      {/* Contenido de la notificación */}
      <div className="flex items-center gap-3 py-3 px-3.5">
        {/* Avatar cuadrado con esquinas ligeramente redondeadas */}
        <div className="w-9 h-9 rounded-[3px] bg-[#3d3d3d] overflow-hidden shrink-0 flex items-center justify-center">
          {avatar ? (
            <img src={avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <Gamepad2 className="w-5 h-5 text-[#67707b]" />
          )}
        </div>

        {/* Texto */}
        <div className="flex flex-col min-w-0">
          {/* Nombre del amigo */}
          <span className="text-[#c6d4df] text-[14px] font-normal leading-[1.2] truncate max-w-55">{title}</span>
          {/* Estado */}
          <span className="text-[#5c7e10] text-[13px] font-normal leading-[1.3] truncate max-w-55">{body}</span>
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

    try {
      const audio = new Audio("/sounds/2575.wav");
      audio.volume = 0.6;
      audio.play().catch((e) => console.warn("[Overlay] Audio autoplay blocked or failed:", e));
    } catch (e) {
      console.warn("[Overlay] Failed to play audio:", e);
    }

    setNotifications((prev) => {
      const updated = [...prev, notification];
      if (updated.length > MAX_NOTIFICATIONS) {
        const removed = updated.shift();
        if (removed) {
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
  const hasSignaledReadyRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;

    const setupListenerAndSignalReady = async () => {
      try {
        unlisten = await listen<NotificationPayload>("show-overlay-notification", (event) => {
          const { title, body } = event.payload;

          if (!title?.trim() || !body?.trim()) {
            console.warn("[Overlay] Notificación inválida descartada", event.payload);
            return;
          }

          addNotification({ title, body });
        });

        if (mounted && !hasSignaledReadyRef.current) {
          await emit("overlay-ready");
          hasSignaledReadyRef.current = true;
        }
      } catch (error) {
        console.error("[Overlay] Error en setup inicial:", error);
      }
    };

    setupListenerAndSignalReady();

    return () => {
      mounted = false;
      unlisten?.();
      cleanup();
    };
  }, [addNotification, cleanup]);

  useEffect(() => {
    if (notifications.length > 0) {
      return;
    }

    const hideTimer = setTimeout(() => {
      void invoke("hide_overlay_window").catch((error) => {
        console.error("[Overlay] No se pudo ocultar la ventana:", error);
      });
    }, OVERLAY_HIDE_DELAY);

    return () => {
      clearTimeout(hideTimer);
    };
  }, [notifications.length]);

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
