import type { CloudInvite } from "@domain/entities/CloudInvite";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import { ApplicationError } from "@application/errors/ApplicationError";

/** Datos necesarios para crear una invitación a una nube compartida. */
export interface CreateCloudInviteInput {
  /** Identificador del propietario de la nube. */
  hostUserId: string;
  /** Identificador opcional del usuario destinatario. */
  inviteeUserId?: string;
  /** Vigencia de la invitación en días. */
  expiresInDays?: number;
  /** Indica si la invitación debe incluir un token transferible. */
  withToken?: boolean;
  /** URL del servidor WebSocket asociado a la nube. */
  wsUrl?: string;
}

/** Crea invitaciones dirigidas o abiertas para una nube compartida. */
export class CreateCloudInviteUseCase {
  /**
   * @param repository - Repositorio que consulta membresías y persiste invitaciones.
   */
  constructor(private readonly repository: CloudInviteRepository) {}

  /**
   * Crea una invitación y limita su vigencia al rango permitido por el servidor.
   * Si el destinatario ya es miembro activo, crea una invitación dirigida con token
   * para que pueda recuperar sus credenciales locales.
   *
   * @param input - Propietario, destinatario opcional y parámetros de la invitación.
   * @returns La invitación creada.
   * @throws {ApplicationError} Si el usuario intenta invitarse a sí mismo.
   */
  async execute(input: CreateCloudInviteInput): Promise<CloudInvite> {
    const host = input.hostUserId.trim();
    const invitee = input.inviteeUserId?.trim();

    if (invitee && invitee === host) {
      throw new ApplicationError("INVALID_ARGUMENT", "No puedes enviarte una invitación a ti mismo.");
    }
    const membership = invitee ? await this.repository.getMembership(host, invitee) : null;
    const isAccessRecoveryInvite = membership?.active === true;

    // Política de invitaciones pendientes antes de ser aceptadas: hasta 365 días de vigencia (por defecto 30 días).
    const ttlDays = Math.max(1, Math.min(input.expiresInDays ?? 30, 365));
    return this.repository.createInvite({
      hostUserId: host,
      inviteeUserId: invitee || undefined,
      ttlSeconds: ttlDays * 24 * 60 * 60,
      withToken: isAccessRecoveryInvite || (input.withToken ?? true),
      wsUrl: input.wsUrl,
    });
  }
}
