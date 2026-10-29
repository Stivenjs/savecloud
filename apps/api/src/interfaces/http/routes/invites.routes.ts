import type { FastifyInstance, FastifyReply } from "fastify";
import { resolvePublicBaseUrl } from "@shared/utils";
import { getBootstrapUserId, getUserId } from "@interfaces/http/helpers/request-context";
import { ApplicationError } from "@application/errors/ApplicationError";
import type { CreateCloudInviteUseCase } from "@application/use-cases/CreateCloudInviteUseCase";
import type { ListPendingCloudInvitesUseCase } from "@application/use-cases/ListPendingCloudInvitesUseCase";
import type { RespondCloudInviteUseCase } from "@application/use-cases/RespondCloudInviteUseCase";
import type { SetCloudGameShareUseCase } from "@application/use-cases/SetCloudGameShareUseCase";
import type { ListCloudPresenceUseCase } from "@application/use-cases/ListCloudPresenceUseCase";
import type { RemoveMemberUseCase } from "@application/use-cases/RemoveMemberUseCase";
import type { CancelMemberDeletionUseCase } from "@application/use-cases/CancelMemberDeletionUseCase";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import { createAccessSession } from "@shared/accessSession";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";
import {
  inviteAcceptanceRateLimit,
  inviteCreationRateLimit,
  memberCancelRemovalRateLimit,
  memberRemovalRateLimit,
  membershipLeaveRateLimit,
} from "@interfaces/http/rate-limits/invite";
import {
  AcceptByTokenSchema,
  type AcceptByTokenBody,
  CreateInviteSchema,
  type CreateInviteBody,
  RespondInviteSchema,
  type RespondInviteBody,
  SetGameShareSchema,
  type SetGameShareBody,
  MembershipActionSchema,
  type MembershipActionBody,
  RemoveMemberSchema,
  type RemoveMemberBody,
} from "@interfaces/schema/invites";

export async function registerInviteRoutes(
  app: FastifyInstance,
  deps: {
    createCloudInviteUseCase: CreateCloudInviteUseCase;
    listPendingCloudInvitesUseCase: ListPendingCloudInvitesUseCase;
    respondCloudInviteUseCase: RespondCloudInviteUseCase;
    setCloudGameShareUseCase: SetCloudGameShareUseCase;
    listCloudPresenceUseCase?: ListCloudPresenceUseCase;
    removeMemberUseCase?: RemoveMemberUseCase;
    cancelMemberDeletionUseCase?: CancelMemberDeletionUseCase;
    cloudInviteRepository: CloudInviteRepository;
    accessSessionRepository?: AccessSessionRepository;
    webSocketNotifier?: WebSocketNotifier;
  }
): Promise<void> {
  app.post<{ Body: CreateInviteBody }>(
    "/invites",
    {
      schema: { body: CreateInviteSchema },
      config: { rateLimit: inviteCreationRateLimit },
    },
    async (request, reply: FastifyReply) => {
      {
        const hostUserId = getUserId(request);
        const invite = await deps.createCloudInviteUseCase.execute({
          hostUserId,
          inviteeUserId: request.body.inviteeUserId?.trim() || undefined,
          expiresInDays: request.body.expiresInDays,
          withToken: request.body.withToken ?? true,
          wsUrl: request.body.wsUrl?.trim() || undefined,
        });
        const baseUrl = resolvePublicBaseUrl(request);
        return reply.send({
          ...invite,
          inviteUrl: invite.token ? `${baseUrl}/invites/accept/${invite.token}` : null,
        });
      }
    }
  );

  app.get("/invites/pending", async (request, reply: FastifyReply) => {
    {
      const userId = getUserId(request);
      const items = await deps.listPendingCloudInvitesUseCase.execute(userId);
      return reply.send({ items });
    }
  });

  app.post<{ Params: { id: string }; Body: RespondInviteBody }>(
    "/invites/:id/respond",
    { schema: { body: RespondInviteSchema } },
    async (request, reply: FastifyReply) => {
      {
        const userId = getUserId(request);
        await deps.respondCloudInviteUseCase.execute({
          userId,
          inviteId: request.params.id,
          action: request.body.action,
        });
        return reply.status(204).send();
      }
    }
  );

  app.post<{ Body: AcceptByTokenBody }>(
    "/invites/accept-token",
    {
      schema: { body: AcceptByTokenSchema },
      config: { rateLimit: inviteAcceptanceRateLimit },
    },
    async (request, reply: FastifyReply) => {
      {
        const userId = getBootstrapUserId(request);
        const invite = await deps.respondCloudInviteUseCase.execute({
          userId,
          token: request.body.token.trim(),
          action: "accept",
        });
        if (!deps.accessSessionRepository) {
          throw new ApplicationError("SERVICE_UNAVAILABLE", "No se puede crear una sesión segura ahora.");
        }
        const session = await createAccessSession(deps.accessSessionRepository, userId, invite.hostUserId);
        return reply.send({
          ...session,
          apiUrl: `${request.protocol}://${request.hostname}`,
          wsUrl: invite.wsUrl,
        });
      }
    }
  );

  app.get("/invites/memberships", async (request, reply: FastifyReply) => {
    {
      const userId = getUserId(request);
      const [hostMemberships, ownMemberMemberships] = await Promise.all([
        deps.cloudInviteRepository.listMembershipsForHost(userId),
        deps.cloudInviteRepository.listMembershipsForMember(userId),
      ]);

      const activeOwnMemberships = ownMemberMemberships.filter((m) => m.active);
      const hostIds = Array.from(new Set(activeOwnMemberships.map((m) => m.hostUserId)));

      const coMembershipsList = await Promise.all(
        hostIds.map((hostId) => deps.cloudInviteRepository.listMembershipsForHost(hostId))
      );

      const memberMembershipsMap = new Map<string, (typeof ownMemberMemberships)[number]>();

      for (const m of ownMemberMemberships) {
        memberMembershipsMap.set(`${m.hostUserId}-${m.memberUserId}`, m);
      }

      for (const list of coMembershipsList) {
        for (const m of list) {
          if (m.active) {
            memberMembershipsMap.set(`${m.hostUserId}-${m.memberUserId}`, m);
          }
        }
      }

      const mergedMemberMemberships = Array.from(memberMembershipsMap.values());

      return reply.send({ hostMemberships, memberMemberships: mergedMemberMemberships });
    }
  });

  if (deps.listCloudPresenceUseCase) {
    app.get("/invites/presence", async (request, reply: FastifyReply) => {
      {
        const userId = getUserId(request);
        const result = await deps.listCloudPresenceUseCase!.execute(userId);
        return reply.send(result);
      }
    });
  }

  app.post<{ Body: SetGameShareBody }>(
    "/invites/games/share",
    { schema: { body: SetGameShareSchema } },
    async (request, reply: FastifyReply) => {
      {
        const hostUserId = getUserId(request);
        const memberUserId = request.body.memberUserId.trim();
        const gameId = request.body.gameId.trim();
        await deps.setCloudGameShareUseCase.execute({
          hostUserId,
          memberUserId,
          gameId,
          shared: true,
        });
        return reply.status(204).send();
      }
    }
  );

  app.post<{ Body: SetGameShareBody }>(
    "/invites/games/unshare",
    { schema: { body: SetGameShareSchema } },
    async (request, reply: FastifyReply) => {
      {
        const hostUserId = getUserId(request);
        const memberUserId = request.body.memberUserId.trim();
        const gameId = request.body.gameId.trim();
        await deps.setCloudGameShareUseCase.execute({
          hostUserId,
          memberUserId,
          gameId,
          shared: false,
        });
        return reply.status(204).send();
      }
    }
  );

  app.post<{ Body: MembershipActionBody }>(
    "/invites/memberships/leave",
    {
      schema: { body: MembershipActionSchema },
      config: { rateLimit: membershipLeaveRateLimit },
    },
    async (request, reply: FastifyReply) => {
      {
        const userId = getUserId(request);
        const hostUserId = request.body.hostUserId.trim();
        const memberUserId = request.body.memberUserId.trim();
        if (userId !== memberUserId) {
          throw new ApplicationError("FORBIDDEN", "Solo el miembro puede abandonar su propia membresía.");
        }
        await deps.cloudInviteRepository.deactivateMembership(hostUserId, memberUserId);
        await deps.accessSessionRepository?.revokeMembershipSessions(hostUserId, memberUserId);
        await deps.webSocketNotifier?.disconnectUser?.(memberUserId);
        return reply.status(204).send();
      }
    }
  );

  app.post<{ Body: RemoveMemberBody }>(
    "/invites/memberships/remove",
    {
      schema: { body: RemoveMemberSchema },
      config: { rateLimit: memberRemovalRateLimit },
    },
    async (request, reply: FastifyReply) => {
      const userId = getUserId(request);
      const hostUserId = request.body.hostUserId.trim();
      const memberUserId = request.body.memberUserId.trim();

      if (deps.removeMemberUseCase) {
        const result = await deps.removeMemberUseCase.execute({
          requesterId: userId,
          hostUserId,
          memberUserId,
          gracePeriodDays: request.body.gracePeriodDays,
        });
        return reply.status(200).send(result);
      }

      if (userId !== hostUserId) {
        throw new ApplicationError("FORBIDDEN", "Solo el anfitrión puede quitar miembros.");
      }
      await deps.cloudInviteRepository.deactivateMembership(hostUserId, memberUserId);
      await deps.accessSessionRepository?.revokeMembershipSessions(hostUserId, memberUserId);
      await deps.webSocketNotifier?.disconnectUser?.(memberUserId);
      return reply.status(204).send();
    }
  );

  app.post<{ Body: MembershipActionBody }>(
    "/invites/memberships/cancel-removal",
    {
      schema: { body: MembershipActionSchema },
      config: { rateLimit: memberCancelRemovalRateLimit },
    },
    async (request, reply: FastifyReply) => {
      const userId = getUserId(request);
      const hostUserId = request.body.hostUserId.trim();
      const memberUserId = request.body.memberUserId.trim();

      if (!deps.cancelMemberDeletionUseCase) {
        throw new ApplicationError("NOT_IMPLEMENTED", "Caso de uso cancelMemberDeletion no configurado.");
      }

      await deps.cancelMemberDeletionUseCase.execute({
        requesterId: userId,
        hostUserId,
        memberUserId,
      });

      return reply.status(204).send();
    }
  );
}
