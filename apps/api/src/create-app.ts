import "reflect-metadata";
import "./auth/fastify-request.js";
import type { IncomingMessage } from "node:http";
import { Logger as NestLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";
import type { ApiConfig } from "@vimla/config";
import { resolveRequestId } from "./observability/logger.js";
import { AppModule } from "./app.module.js";
import { AUTH_BASE_PATH } from "@vimla/auth";
import { isDevNotificationInboxEnabled } from "@vimla/notifications";
import { AuthService } from "./auth/auth.service.js";
import { handleBetterAuthRequest } from "./auth/better-auth.fastify.js";
import { ApiExceptionFilter } from "./http/api-exception.filter.js";

export async function createVimlaApiApp(
  config: ApiConfig,
  options?: { quiet?: boolean },
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    genReqId: (request: IncomingMessage) => resolveRequestId(request.headers),
    requestIdHeader: "x-request-id",
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config),
    adapter,
    options?.quiet ? { logger: false } : { bufferLogs: true },
  );

  if (!options?.quiet) {
    app.useLogger(app.get(Logger));
  }

  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: [config.webOrigin, config.adminOrigin],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Request-Id",
      "X-Correlation-Id",
    ],
  });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.setReplySerializer((payload) =>
    JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  );
  const authService = app.get(AuthService);
  fastify.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: `${AUTH_BASE_PATH}/*`,
    async handler(request, reply) {
      await handleBetterAuthRequest(
        request,
        reply,
        authService.auth,
        config.betterAuthUrl,
      );
    },
  });

  if (!options?.quiet && isDevNotificationInboxEnabled(config.appEnv)) {
    const logger = new NestLogger("DevNotifications");
    logger.log(
      `GET /dev/notifications/latest registered (APP_ENV=${config.appEnv}, EMAIL_PROVIDER=${config.emailProvider}, SMS_PROVIDER=${config.smsProvider})`,
    );
  }

  return app;
}
