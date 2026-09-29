import { apiErrorResponseSchema } from "@vimla/contracts";

export type ClientPayloadParser<T> = (payload: unknown) => T;

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

export class ClientApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "ClientApiError";
  }
}

export interface ClientTransportRequest<T> {
  init?: RequestInit;
  parse: ClientPayloadParser<T>;
  errorFactory?: (code: string, status: number) => Error;
}

export interface ClientTransport {
  request<T>(
    path: string,
    request: ClientTransportRequest<T>,
  ): Promise<T>;
}

export interface ClientTransportConfig {
  baseUrl: string;
  fetchImpl: typeof fetch;
  defaultInit?: RequestInit;
}

export function createClientTransport(
  config: ClientTransportConfig,
): ClientTransport {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  return {
    async request<T>(
      path: string,
      request: ClientTransportRequest<T>,
    ): Promise<T> {
      const defaultHeaders = headersRecord(config.defaultInit?.headers);
      const requestHeaders = headersRecord(request.init?.headers);
      const response = await config.fetchImpl(
        `${baseUrl}${path}`,
        {
          ...config.defaultInit,
          ...request.init,
          headers:
            Object.keys(defaultHeaders).length > 0 ||
            Object.keys(requestHeaders).length > 0
              ? { ...defaultHeaders, ...requestHeaders }
              : undefined,
        },
      );
      if (response.status === 401) {
        throw new AuthRequiredError();
      }
      const payload: unknown =
        response.status === 204
          ? undefined
          : await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = apiErrorResponseSchema.safeParse(payload);
        const code = parsed.success
          ? parsed.data.error.code
          : "internal_error";
        throw request.errorFactory?.(code, response.status) ??
          new ClientApiError(code, response.status);
      }
      return request.parse(payload);
    },
  };
}

export function jsonRequestInit(
  method: string,
  body: unknown,
  signal?: AbortSignal,
): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  };
}

export function queryString(
  entries: ReadonlyArray<readonly [string, string | number | undefined | null]>,
): string {
  const parts = entries.flatMap(([key, value]) =>
    value === undefined || value === null || value === ""
      ? []
      : [
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
        ],
  );
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function headersRecord(
  headers: RequestInit["headers"],
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (Array.isArray(entry) && entry.length >= 2) {
        result[String(entry[0])] = String(entry[1]);
      }
    }
    return result;
  }

  const iterable = headers as {
    entries?: () => IterableIterator<[string, string]>;
  };
  if (typeof iterable.entries === "function") {
    for (const [key, value] of iterable.entries()) {
      result[key] = value;
    }
    return result;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.join(", ");
    }
  }
  return result;
}
