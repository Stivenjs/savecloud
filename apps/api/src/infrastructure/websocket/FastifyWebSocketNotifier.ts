/**
 * @file FastifyWebSocketNotifier.ts
 * @description Implementación en memoria del puerto WebSocketNotifier para entronos Fastify/Bun local/Docker.
 */

import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";

/**
 * Representa una conexión WebSocket abstraída (compatible con `ws.WebSocket` y `ServerWebSocket` de Bun).
 */
export interface GenericWebSocketConnection {
  /** Estado de la conexión (1 = OPEN) */
  readyState: number;
  /** Envía un mensaje a través del socket */
  send(data: string | Uint8Array | ArrayBufferLike): void;
  /** Cierra la conexión activamente */
  close?(code?: number, reason?: string): void;
}

/**
 * @class FastifyWebSocketNotifier
 * @implements {WebSocketNotifier}
 * @description Notificador de WebSocket en memoria para servidor Fastify en entornos standalone/Docker.
 * Mantiene un registro de conexiones activas (connectionId -> socket WebSocket) y envía notificaciones en tiempo real.
 */
export class FastifyWebSocketNotifier implements WebSocketNotifier {
  private readonly activeSockets = new Map<string, GenericWebSocketConnection>();

  constructor(private readonly connectionRepo?: ConnectionRepository) {}

  /**
   * Registra una conexión WebSocket activa asociada a un connectionId.
   *
   * @param connectionId - Identificador único de la conexión.
   * @param socket - Socket activo (instancia de ws o ServerWebSocket de Bun).
   */
  registerSocket(connectionId: string, socket: GenericWebSocketConnection): void {
    this.activeSockets.set(connectionId, socket);
  }

  /**
   * Elimina un socket de la lista de conexiones activas.
   *
   * @param connectionId - Identificador único de la conexión.
   */
  unregisterSocket(connectionId: string): void {
    this.activeSockets.delete(connectionId);
  }

  /**
   * Envía un payload JSON al socket especificado por connectionId.
   *
   * @param connectionId - Identificador de la conexión destino.
   * @param payload - Objeto o cadena a enviar.
   */
  async sendToConnection(connectionId: string, payload: unknown): Promise<void> {
    const socket = this.activeSockets.get(connectionId);

    if (!socket || socket.readyState !== 1 /* OPEN */) {
      this.activeSockets.delete(connectionId);
      if (this.connectionRepo) {
        await this.connectionRepo.deleteConnection(connectionId).catch(() => {});
      }
      return;
    }

    try {
      const data = typeof payload === "string" ? payload : JSON.stringify(payload);
      socket.send(data);
    } catch (error) {
      console.error(`[FastifyWS] Error enviando mensaje a la conexión ${connectionId}:`, error);
      this.activeSockets.delete(connectionId);
      if (this.connectionRepo) {
        await this.connectionRepo.deleteConnection(connectionId).catch(() => {});
      }
    }
  }
}
