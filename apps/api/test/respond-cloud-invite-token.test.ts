import { describe, expect, test } from "bun:test";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import { ApplicationError } from "@application/errors/ApplicationError";
import { RespondCloudInviteUseCase } from "@application/use-cases/RespondCloudInviteUseCase";

describe("RespondCloudInviteUseCase", () => {
  test("rejects malformed tokens before using them as storage keys", async () => {
    let lookedUpToken = false;
    const repository = {
      getInviteByToken: async () => {
        lookedUpToken = true;
        return null;
      },
    } as unknown as CloudInviteRepository;
    const useCase = new RespondCloudInviteUseCase(repository);

    try {
      await useCase.execute({
        userId: "member",
        token: "55https://localhost:3000/invites/accept/5571a1ade6ee46173aa026bd6c22a6e65a7a11ca9c4b7740",
        action: "accept",
      });
      throw new Error("Expected an invalid-token error");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError);
      expect((error as ApplicationError).code).toBe("INVALID_ARGUMENT");
      expect((error as Error).message).toBe("El código de invitación no es válido.");
    }

    expect(lookedUpToken).toBe(false);
  });
});
