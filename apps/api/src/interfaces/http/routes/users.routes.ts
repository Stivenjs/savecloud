import type { FastifyInstance, FastifyReply } from "fastify";
import { getUserId, getErrorMessage } from "@shared/utils";
import type { GetFriendProfileUseCase } from "@application/use-cases/GetFriendProfileUseCase";
import { GetFriendProfileParamsSchema, type GetFriendProfileParams } from "@interfaces/schema/user-profile";

export async function registerProfileRoutes(
  app: FastifyInstance,
  deps: { getFriendProfileUseCase: GetFriendProfileUseCase }
): Promise<void> {
  app.get<{ Params: GetFriendProfileParams }>(
    "/users/:targetUserId/profile",
    {
      schema: {
        params: GetFriendProfileParamsSchema,
      },
    },
    async (request, reply: FastifyReply) => {
      try {
        const requesterUserId = getUserId(request);

        const targetUserId = request.params.targetUserId.trim();

        const profileData = await deps.getFriendProfileUseCase.execute(requesterUserId, targetUserId);
        return reply.send(profileData);
      } catch (err) {
        const message = getErrorMessage(err);
        if (message.includes("does not have any config saved in the cloud")) {
          return reply.status(404).send({ error: "Not Found", message });
        }
        request.log.error({ err }, "Error getting friend profile");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );
}
