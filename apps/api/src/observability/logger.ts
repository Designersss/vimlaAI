import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { Options } from "pino-http";
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  createCorrelationId,
  readCorrelationId,
} from "@vimla/shared";
import type { LogLevel } from "@vimla/config";

type HeaderMap = Record<string, string | string[] | undefined>;

export function shouldSkipPinoAutoLogging(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  const path = url.split("?")[0] ?? "";
  return /\/v1\/conversations\/[^/]+\/messages$/.test(path);
}

export function createPinoHttpOptions(logLevel: LogLevel): Options {
  return {
    level: logLevel,
    autoLogging: {
      ignore: (req) => {
        const withOriginal = req as IncomingMessage & { originalUrl?: string };
        return shouldSkipPinoAutoLogging(withOriginal.originalUrl ?? req.url);
      },
    },
    genReqId: (req: IncomingMessage, _res: ServerResponse) =>
      resolveRequestId(req.headers),
    customProps: (req: IncomingMessage) => {
      const requestId = "id" in req ? String(req.id) : undefined;
      return { correlationId: requestId };
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["set-cookie"]',
        "req.headers.x-api-key",
        "req.body.password",
        "req.body.currentPassword",
        "req.body.newPassword",
        "req.body.otp",
        "req.body.code",
        "req.body.token",
        "req.query.token",
        "req.body.resetToken",
        "req.query.otp",
        "req.body.cardNumber",
        "req.body.cvv",
        "req.body.providerSecret",
        "req.body.PROXYAPI_API_KEY",
        "config.proxyapiApiKey",
        "config.smtpPassword",
        "config.smsHttpAuthorization",
        "config.betterAuthSecret",
      ],
      remove: true,
    },
  };
}

export function resolveRequestId(headers: IncomingHttpHeaders): string {
  return readCorrelationId(toHeaderMap(headers)) ?? createCorrelationId();
}

export function requestIdResponseHeaders(requestId: string): Record<string, string> {
  return {
    [REQUEST_ID_HEADER]: requestId,
    [CORRELATION_ID_HEADER]: requestId,
  };
}

function toHeaderMap(headers: IncomingHttpHeaders): HeaderMap {
  const mapped: HeaderMap = {};

  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string" || Array.isArray(value)) {
      mapped[name] = value;
    }
  }

  return mapped;
}
