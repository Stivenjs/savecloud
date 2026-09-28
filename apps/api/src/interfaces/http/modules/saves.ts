import type { FastifyInstance } from "fastify";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { GameStatRepository } from "@domain/ports/GameStatRepository";
import type { SaveFileIndexRepository } from "@domain/ports/SaveFileIndexRepository";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { SteamSeedRepository } from "@domain/ports/SteamSeedRepository";
import { AbortMultipartUploadUseCase } from "@application/use-cases/AbortMultipartUploadUseCase";
import { CompleteMultipartUploadUseCase } from "@application/use-cases/CompleteMultipartUploadUseCase";
import { CreateMultipartUploadUseCase } from "@application/use-cases/CreateMultipartUploadUseCase";
import { CreateMultipartUploadWithPartUrlsUseCase } from "@application/use-cases/CreateMultipartUploadWithPartUrlsUseCase";
import { DeleteBackupUseCase } from "@application/use-cases/DeleteBackupUseCase";
import { DeleteGameFromCloudUseCase } from "@application/use-cases/DeleteGameFromCloudUseCase";
import { GetDownloadUrlUseCase } from "@application/use-cases/GetDownloadUrlUseCase";
import { GetDownloadUrlsUseCase } from "@application/use-cases/GetDownloadUrlsUseCase";
import { GetGameSummaryUseCase } from "@application/use-cases/GetGameSummaryUseCase";
import { GetUploadPartUrlsUseCase } from "@application/use-cases/GetUploadPartUrlsUseCase";
import { GetUploadUrlUseCase } from "@application/use-cases/GetUploadUrlUseCase";
import { GetUploadUrlsUseCase } from "@application/use-cases/GetUploadUrlsUseCase";
import { ListBackupsUseCase } from "@application/use-cases/ListBackupsUseCase";
import { ListSavesUseCase } from "@application/use-cases/ListSavesUseCase";
import { RenameBackupUseCase } from "@application/use-cases/RenameBackupUseCase";
import { RenameGameInCloudUseCase } from "@application/use-cases/RenameGameInCloudUseCase";
import { ResolveCloudStorageScopeUseCase } from "@application/use-cases/ResolveCloudStorageScopeUseCase";
import { registerSavesRoutes } from "@interfaces/http/routes/saves.routes";

export async function registerSavesModule(
  app: FastifyInstance,
  deps: {
    saveRepository: SaveRepository;
    saveFileIndexRepository?: SaveFileIndexRepository;
    gameStatRepository?: GameStatRepository;
    steamSeedRepository?: SteamSeedRepository;
    cloudInviteRepository?: CloudInviteRepository;
  }
): Promise<ResolveCloudStorageScopeUseCase | undefined> {
  const resolveCloudStorageScopeUseCase = deps.cloudInviteRepository
    ? new ResolveCloudStorageScopeUseCase(deps.cloudInviteRepository)
    : undefined;

  await registerSavesRoutes(app, {
    getUploadUrlUseCase: new GetUploadUrlUseCase(deps.saveRepository),
    getUploadUrlsUseCase: new GetUploadUrlsUseCase(deps.saveRepository),
    getDownloadUrlUseCase: new GetDownloadUrlUseCase(deps.saveRepository),
    getDownloadUrlsUseCase: new GetDownloadUrlsUseCase(deps.saveRepository),
    deleteGameFromCloudUseCase: new DeleteGameFromCloudUseCase(deps.saveRepository),
    renameGameInCloudUseCase: new RenameGameInCloudUseCase(deps.saveRepository),
    listSavesUseCase: new ListSavesUseCase(deps.saveRepository, deps.saveFileIndexRepository),
    getGameSummaryUseCase: deps.gameStatRepository ? new GetGameSummaryUseCase(deps.gameStatRepository) : undefined,
    listBackupsUseCase: new ListBackupsUseCase(deps.saveRepository, deps.saveFileIndexRepository),
    deleteBackupUseCase: new DeleteBackupUseCase(deps.saveRepository),
    renameBackupUseCase: new RenameBackupUseCase(deps.saveRepository),
    createMultipartUploadUseCase: new CreateMultipartUploadUseCase(deps.saveRepository),
    createMultipartUploadWithPartUrlsUseCase: new CreateMultipartUploadWithPartUrlsUseCase(deps.saveRepository),
    getUploadPartUrlsUseCase: new GetUploadPartUrlsUseCase(deps.saveRepository),
    completeMultipartUploadUseCase: new CompleteMultipartUploadUseCase(deps.saveRepository),
    abortMultipartUploadUseCase: new AbortMultipartUploadUseCase(deps.saveRepository),
    steamSeedRepository: deps.steamSeedRepository,
    resolveCloudStorageScopeUseCase,
    cloudInviteRepository: deps.cloudInviteRepository,
  });

  return resolveCloudStorageScopeUseCase;
}
