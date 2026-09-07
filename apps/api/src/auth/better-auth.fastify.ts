import type { IncomingHttpHeaders } from "node:http";
import { fromNodeHeaders } from "better-auth/node";
import type { VimlaAuth } from "@vimla/auth";

export interface BetterAuthRequest {
  url: string;
  method: string;
  headers: IncomingHttpHeaders;
  body?: unknown;
}

export interface BetterAuthReply {
  status: (code: number) => unknown;
  header: (name: string, value: string | number | Array<string>) => unknown;
  send: (payload: unknown) => unknown;
}

export async function handleBetterAuthRequest(
  request: BetterAuthRequest,
  reply: BetterAuthReply,
  auth: VimlaAuth,
  baseURL: string,
): Promise<unknown> {
  const response = await auth.handler(toFetchRequest(request, baseURL));
  return sendAuthResponse(reply, response);
}

function toFetchRequest(request: BetterAuthRequest, baseURL: string): Request {
  const url = new URL(request.url, baseURL);
  const headers = fromNodeHeaders(request.headers);
  const method = request.method.toUpperCase();
  const canHaveBody = method !== "GET" && method !== "HEAD";

  if (!canHaveBody || request.body === undefined || request.body === null) {
    return new Request(url, { method, headers });
  }

  const body =
    typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body);

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(url, { method, headers, body });
}

async function sendAuthResponse(
  reply: BetterAuthReply,
  response: Response,
): Promise<unknown> {
  reply.status(response.status);

  const cookies = response.headers.getSetCookie();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      return;
    }
    reply.header(key, value);
  });

  if (cookies.length > 0) {
    reply.header("set-cookie", cookies);
  }

  const payload = await response.text();
  if (payload.length === 0) {
    return reply.send(null);
  }

  return reply.send(payload);
}
