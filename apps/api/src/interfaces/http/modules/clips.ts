import type { FastifyInstance } from "fastify";
import type { ClipRepository } from "@domain/ports/ClipRepository";
import { registerClipRoutes } from "@interfaces/http/routes/clips.routes";

export async function registerClipsModule(app: FastifyInstance, clipRepository?: ClipRepository): Promise<void> {
  if (!clipRepository) return;
  await registerClipRoutes(app, clipRepository);
}
