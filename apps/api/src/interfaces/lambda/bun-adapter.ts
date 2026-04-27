import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";

/**
 * Representa un handler estándar de AWS Lambda para API Gateway v2.
 */
export type LambdaHttpHandler = (event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyResultV2>;

/**
 * Representa un handler genérico de AWS Lambda para eventos JSON (S3, SQS, etc).
 */
export type LambdaEventHandler<TEvent = unknown, TResult = unknown> = (
  event: TEvent,
  context: Context
) => Promise<TResult>;

/**
 * Crea un adaptador que convierte una petición HTTP de Bun en un evento APIGatewayProxyEventV2.
 * @param handler El handler original de Lambda que espera el evento de AWS.
 */
export function createBunHttpAdapter(handler: LambdaHttpHandler) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    const event: APIGatewayProxyEventV2 = {
      version: "2.0",
      routeKey: "$default",
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      headers: Object.fromEntries(request.headers.entries()),
      cookies: request.headers.get("cookie")?.split("; ").filter(Boolean) || [],
      requestContext: {
        accountId: "unknown",
        apiId: "unknown",
        domainName: url.hostname,
        domainPrefix: "unknown",
        http: {
          method: request.method,
          path: url.pathname,
          protocol: "HTTP/1.1",
          sourceIp: request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1",
          userAgent: request.headers.get("user-agent") || "BunRuntime",
        },
        requestId: request.headers.get("x-amzn-requestid") || globalThis.crypto.randomUUID(),
        routeKey: "$default",
        stage: "$default",
        time: new Date().toISOString(),
        timeEpoch: Date.now(),
      },
      body: await request.text(),
      isBase64Encoded: false,
    };

    const result = await handler(event, createFakeContext());

    if (typeof result === "string") {
      return new Response(result, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const body = result.body ?? "";
    const headers = (result.headers as Record<string, string | number | boolean>) ?? {};
    const statusCode = result.statusCode ?? 200;

    return new Response(result.isBase64Encoded ? Buffer.from(body, "base64") : body, {
      status: statusCode,
      headers: Object.entries(headers).reduce(
        (acc, [k, v]) => {
          acc[k.toLowerCase()] = String(v);
          return acc;
        },
        {} as Record<string, string>
      ),
    });
  };
}

/**
 * Crea un adaptador para eventos que no son HTTP (S3, SQS, etc) donde el Layer de Bun
 * pasa el JSON del evento original en el cuerpo (body) del Request.
 */
export function createBunEventAdapter<TEvent, TResult>(handler: LambdaEventHandler<TEvent, TResult>) {
  return async (request: Request): Promise<Response> => {
    try {
      const event = (await request.json()) as TEvent;
      const result = await handler(event, createFakeContext());

      return new Response(JSON.stringify(result ?? { ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("[BunAdapter] Error processing event:", error);
      return new Response(
        JSON.stringify({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };
}

/**
 * Genera un objeto Context "mock" para cumplir con la firma de las funciones de Lambda.
 */
function createFakeContext(): Context {
  const id = globalThis.crypto.randomUUID();
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "bun-handler",
    functionVersion: "$LATEST",
    invokedFunctionArn: `arn:aws:lambda:us-east-2:000000000000:function:bun-handler`,
    memoryLimitInMB: "128",
    awsRequestId: id,
    logGroupName: "/aws/lambda/bun-handler",
    logStreamName: `2024/01/01/[$LATEST]${id.replace(/-/g, "")}`,
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  } as Context;
}
