import {
  REALTIME_PROTOCOL_VERSION,
  realtimePongFrameSchema,
  realtimeServerFrameSchema,
  type RealtimeEventEnvelope,
} from "@vimla/contracts";
import { publicWebConfig } from "../config/public-env";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
const TERMINAL_CLOSE_CODES = new Set([
  4002,
  4003,
  4004,
]);

interface RealtimeSocket {
  onopen: (() => void) | null;
  onmessage:
    | ((event: { data: unknown }) => void)
    | null;
  onclose:
    | ((event: { code: number }) => void)
    | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SubscribeRealtimeOptions {
  installationId: string;
  onEvent: (event: RealtimeEventEnvelope) => void;
  onOpen?: () => void;
  socketFactory?: (url: string) => RealtimeSocket;
  setTimeoutFn?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (
    handle: ReturnType<typeof setTimeout>,
  ) => void;
}

export function subscribeRealtime(
  options: SubscribeRealtimeOptions,
): () => void {
  const socketFactory =
    options.socketFactory ??
    ((url: string): RealtimeSocket =>
      new WebSocket(url) as unknown as RealtimeSocket);
  const setTimeoutFn =
    options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn =
    options.clearTimeoutFn ?? clearTimeout;

  let stopped = false;
  let socket: RealtimeSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null =
    null;
  let retryAttempt = 0;

  const connect = (): void => {
    if (stopped) {
      return;
    }
    const current = socketFactory(
      realtimeWebSocketUrl(options.installationId),
    );
    socket = current;

    current.onopen = () => undefined;
    current.onmessage = (event) => {
      const payload = parseSocketPayload(event.data);
      const parsed =
        realtimeServerFrameSchema.safeParse(payload);
      if (!parsed.success) {
        current.close(1002, "invalid_server_frame");
        return;
      }

      if (parsed.data.frameType === "HELLO") {
        retryAttempt = 0;
        options.onOpen?.();
        return;
      }
      if (parsed.data.frameType === "HEARTBEAT") {
        current.send(
          JSON.stringify(
            realtimePongFrameSchema.parse({
              protocolVersion:
                REALTIME_PROTOCOL_VERSION,
              frameType: "PONG",
              heartbeatId:
                parsed.data.heartbeatId,
            }),
          ),
        );
        return;
      }
      options.onEvent(parsed.data);
    };

    current.onerror = () => undefined;
    current.onclose = (event) => {
      if (socket === current) {
        socket = null;
      }
      if (
        stopped ||
        TERMINAL_CLOSE_CODES.has(event.code)
      ) {
        return;
      }
      const delay = reconnectDelay(retryAttempt);
      retryAttempt += 1;
      retryTimer = setTimeoutFn(() => {
        retryTimer = null;
        connect();
      }, delay);
    };
  };

  connect();

  return () => {
    stopped = true;
    if (retryTimer !== null) {
      clearTimeoutFn(retryTimer);
      retryTimer = null;
    }
    const current = socket;
    socket = null;
    current?.close(1000, "client_close");
  };
}

export function realtimeWebSocketUrl(
  installationId: string,
  apiBaseUrl = publicWebConfig.apiBaseUrl,
): string {
  const url = new URL(apiBaseUrl);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else {
    throw new Error(
      "Realtime API base URL must use http or https",
    );
  }
  url.pathname =
    `${url.pathname.replace(/\/$/, "")}/v1/realtime`;
  url.search = "";
  url.searchParams.set(
    "protocolVersion",
    String(REALTIME_PROTOCOL_VERSION),
  );
  url.searchParams.set(
    "installationId",
    installationId,
  );
  return url.toString();
}

function reconnectDelay(attempt: number): number {
  return Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * 2 ** Math.min(attempt, 8),
  );
}

function parseSocketPayload(payload: unknown): unknown {
  if (typeof payload === "string") {
    return parseJson(payload);
  }
  if (payload instanceof ArrayBuffer) {
    return parseJson(
      new TextDecoder().decode(payload),
    );
  }
  return null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
