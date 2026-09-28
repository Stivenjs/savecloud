/** Publica un aviso cuando cambian las notificaciones visibles de un usuario. */
export interface NotificationChangeNotifier {
  notifyChanged(userId: string, cursor: string): Promise<void>;
}
