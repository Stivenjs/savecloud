import type { FastifyInstance, FastifyReply } from "fastify";
import { getUserId } from "@interfaces/http/helpers/request-context";
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
      {
        const requesterUserId = getUserId(request);

        const targetUserId = request.params.targetUserId.trim();

        const profileData = await deps.getFriendProfileUseCase.execute(requesterUserId, targetUserId);
        return reply.send(profileData);
      }
    }
  );
}
