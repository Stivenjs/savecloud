import type { FastifyInstance, FastifyReply } from "fastify";
import { getUserId, getErrorMessage, resolvePublicBaseUrl } from "@shared/utils";
import type { CreateCloudInviteUseCase } from "@application/use-cases/CreateCloudInviteUseCase";
import type { ListPendingCloudInvitesUseCase } from "@application/use-cases/ListPendingCloudInvitesUseCase";
import type { RespondCloudInviteUseCase } from "@application/use-cases/RespondCloudInviteUseCase";
import type { SetCloudGameShareUseCase } from "@application/use-cases/SetCloudGameShareUseCase";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import { issueUserAccessToken } from "@shared/accessToken";
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
} from "@interfaces/schema/invites";

export async function registerInviteRoutes(
  app: FastifyInstance,
  deps: {
    createCloudInviteUseCase: CreateCloudInviteUseCase;
    listPendingCloudInvitesUseCase: ListPendingCloudInvitesUseCase;
    respondCloudInviteUseCase: RespondCloudInviteUseCase;
    setCloudGameShareUseCase: SetCloudGameShareUseCase;
    cloudInviteRepository: CloudInviteRepository;
  }
): Promise<void> {
  app.post<{ Body: CreateInviteBody }>(
    "/invites",
    { schema: { body: CreateInviteSchema } },
    async (request, reply: FastifyReply) => {
      try {
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
      } catch (err) {
        return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
      }
    }
  );

  app.get("/invites/pending", async (request, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      const items = await deps.listPendingCloudInvitesUseCase.execute(userId);
      return reply.send({ items });
    } catch (err) {
      return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
    }
  });

  app.post<{ Params: { id: string }; Body: RespondInviteBody }>(
    "/invites/:id/respond",
    { schema: { body: RespondInviteSchema } },
    async (request, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        await deps.respondCloudInviteUseCase.execute({
          userId,
          inviteId: request.params.id,
          action: request.body.action,
        });
        return reply.status(204).send();
      } catch (err) {
        const message = getErrorMessage(err);
        const status = message.includes("not found") ? 404 : message.includes("does not belong") ? 403 : 400;
        return reply.status(status).send({ error: "Bad Request", message });
      }
    }
  );

  app.post<{ Body: AcceptByTokenBody }>(
    "/invites/accept-token",
    { schema: { body: AcceptByTokenSchema } },
    async (request, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        const invite = await deps.respondCloudInviteUseCase.execute({
          userId,
          token: request.body.token.trim(),
          action: "accept",
        });
        const accessToken = issueUserAccessToken(userId, 30 * 24 * 60 * 60);
        return reply.send({
          accessToken,
          apiUrl: `${request.protocol}://${request.hostname}`,
          hostUserId: invite.hostUserId,
          wsUrl: invite.wsUrl,
        });
      } catch (err) {
        const message = getErrorMessage(err);
        const status = message.includes("not found") ? 404 : message.includes("does not belong") ? 403 : 400;
        return reply.status(status).send({ error: "Bad Request", message });
      }
    }
  );

  app.get("/invites/memberships", async (request, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      const hostMemberships = await deps.cloudInviteRepository.listMembershipsForHost(userId);
      const memberMemberships = await deps.cloudInviteRepository.listMembershipsForMember(userId);
      return reply.send({ hostMemberships, memberMemberships });
    } catch (err) {
      return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
    }
  });

  app.post<{ Body: SetGameShareBody }>(
    "/invites/games/share",
    { schema: { body: SetGameShareSchema } },
    async (request, reply: FastifyReply) => {
      try {
        const hostUserId = getUserId(request);
        await deps.setCloudGameShareUseCase.execute({
          hostUserId,
          memberUserId: request.body.memberUserId.trim(),
          gameId: request.body.gameId.trim(),
          shared: true,
        });
        return reply.status(204).send();
      } catch (err) {
        return reply.status(400).send({ error: "Bad Request", message: getErrorMessage(err) });
      }
    }
  );

  app.post<{ Body: SetGameShareBody }>(
    "/invites/games/unshare",
    { schema: { body: SetGameShareSchema } },
    async (request, reply: FastifyReply) => {
      try {
        const hostUserId = getUserId(request);
        await deps.setCloudGameShareUseCase.execute({
          hostUserId,
          memberUserId: request.body.memberUserId.trim(),
          gameId: request.body.gameId.trim(),
          shared: false,
        });
        return reply.status(204).send();
      } catch (err) {
        return reply.status(400).send({ error: "Bad Request", message: getErrorMessage(err) });
      }
    }
  );

  app.post<{ Body: MembershipActionBody }>(
    "/invites/memberships/leave",
    { schema: { body: MembershipActionSchema } },
    async (request, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        const hostUserId = request.body.hostUserId.trim();
        const memberUserId = request.body.memberUserId.trim();
        if (userId !== memberUserId) {
          return reply.status(403).send({ error: "Forbidden", message: "Only member can leave its own membership" });
        }
        await deps.cloudInviteRepository.deactivateMembership(hostUserId, memberUserId);
        return reply.status(204).send();
      } catch (err) {
        return reply.status(400).send({ error: "Bad Request", message: getErrorMessage(err) });
      }
    }
  );

  app.post<{ Body: MembershipActionBody }>(
    "/invites/memberships/remove",
    { schema: { body: MembershipActionSchema } },
    async (request, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        const hostUserId = request.body.hostUserId.trim();
        const memberUserId = request.body.memberUserId.trim();
        if (userId !== hostUserId) {
          return reply.status(403).send({ error: "Forbidden", message: "Only host can remove members" });
        }
        await deps.cloudInviteRepository.deactivateMembership(hostUserId, memberUserId);
        return reply.status(204).send();
      } catch (err) {
        return reply.status(400).send({ error: "Bad Request", message: getErrorMessage(err) });
      }
    }
  );
}
