import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";

/**
 * @class ApiGatewayNotifier
 * @implements {WebSocketNotifier}
 */
export class ApiGatewayNotifier implements WebSocketNotifier {
  private readonly client: ApiGatewayManagementApiClient;

  constructor(
    endpoint: string,
    private readonly connectionRepo: ConnectionRepository
  ) {
    const httpsEndpoint = endpoint.replace("wss://", "https://");
    this.client = new ApiGatewayManagementApiClient({ endpoint: httpsEndpoint });
  }

  async sendToConnection(connectionId: string, payload: any): Promise<void> {
    try {
      await this.client.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify(payload)),
        })
      );
    } catch (error: any) {
      // 410 (Gone) significa que el usuario perdió internet o cerró la app sin avisar
      if (error.$metadata?.httpStatusCode === 410) {
        await this.connectionRepo.deleteConnection(connectionId);
      }
    }
  }
}
