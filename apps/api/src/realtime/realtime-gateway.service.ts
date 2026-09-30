import { type IncomingMessage, type Server as HttpServer } from "node:http";
import { type Duplex } from "node:stream";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import {
  REALTIME_PROTOCOL_VERSION,
  clientInstallationIdSchema,
  realtimeClientFrameSchema,
  realtimeHeartbeatFrameSchema,
  realtimeHelloFrameSchema,
  realtimeServerFrameSchema,
  type RealtimeEventEnvelope,
  type RealtimeServerFrame,
} from "@vimla/contracts";
import {
  WebSocket,
  WebSocketServer,
  type RawData,
} from "ws";
import { AuthService } from "../auth/auth.service.js";
import { HandleService } from "../auth/handle.service.js";
import {
  API_CONFIG,
  type ApiRuntimeConfig,
} from "../config/api-config.js";
import { ClientInstallationsService } from "../installations/client-installations.service.js";
import { RealtimeService } from "./realtime.service.js";

const REALTIME_PATH = "/v1/realtime";
const CLOSE_HEARTBEAT_TIMEOUT = 4001;
const CLOSE_SESSION_INVALID = 4002;
const CLOSE_INSTALLATION_INACTIVE = 4003;
const CLOSE_INVALID_FRAME = 4004;
const CLOSE_RATE_LIMITED = 4005;
interface ConnectionState {
  readonly connectionId: string;
  readonly userId: string;
  readonly installationId: string;
  readonly socket: WebSocket;
  readonly requestHeaders: IncomingMessage["headers"];
  unsubscribe: () => void;
  heartbeatTimer: NodeJS.Timeout | null;
  expectedHeartbeatId: string | null;
  heartbeatSentAt: number | null;
  frameWindowStartedAt: number;
  frameCount: number;
  closed: boolean;
}

@Injectable()
export class RealtimeGatewayService
  implements OnModuleDestroy
{
  private readonly logger = new Logger(
    RealtimeGatewayService.name,
  );
  private readonly wss: WebSocketServer;
  private readonly connections = new Map<
    string,
    ConnectionState
  >();
  private readonly installationConnections = new Map<
    string,
    Set<string>
  >();
  private attachedServer: HttpServer | null = null;

  constructor(
    @Inject(API_CONFIG)
    private readonly config: ApiRuntimeConfig,
    @Inject(AuthService)
    private readonly auth: AuthService,
    @Inject(HandleService)
    private readonly handles: HandleService,
    @Inject(ClientInstallationsService)
    private readonly installations: ClientInstallationsService,
    @Inject(RealtimeService)
    private readonly realtime: RealtimeService,
  ) {
    if (
      config.realtimeHeartbeatTimeoutMs <=
      config.realtimeHeartbeatIntervalMs
    ) {
      throw new Error(
        "Realtime heartbeat timeout must exceed heartbeat interval",
      );
    }
    this.wss = new WebSocketServer({
      noServer: true,
      clientTracking: false,
      maxPayload: config.realtimeFrameBytesMax,
      perMessageDeflate: false,
    });
  }

  attach(server: HttpServer): void {
    if (this.attachedServer === server) {
      return;
    }
    if (this.attachedServer) {
      throw new Error(
        "Realtime gateway is already attached to another server",
      );
    }
    this.attachedServer = server;
    server.on("upgrade", this.handleUpgrade);
  }

  private readonly handleUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    let url: URL;
    try {
      url = new URL(
        request.url ?? "/",
        this.config.betterAuthUrl,
      );
    } catch {
      this.rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    if (url.pathname !== REALTIME_PATH) {
      this.rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    void this.authorizeUpgrade(request, url)
      .then((authorized) => {
        if (!authorized.ok) {
          this.rejectUpgrade(
            socket,
            authorized.status,
            authorized.reason,
          );
          return;
        }

        if (
          !this.reserveInstallationConnection(
            authorized.installationId,
            authorized.connectionId,
          )
        ) {
          this.rejectUpgrade(
            socket,
            429,
            "Too Many Requests",
          );
          return;
        }

        try {
          this.wss.handleUpgrade(
            request,
            socket,
            head,
            (webSocket) => {
              this.acceptConnection(
                webSocket,
                request,
                authorized,
              );
            },
          );
        } catch (error: unknown) {
          this.releaseInstallationConnection(
            authorized.installationId,
            authorized.connectionId,
          );
          this.logger.warn({
            msg: "realtime.upgrade_failed",
            connectionId: authorized.connectionId,
            error:
              error instanceof Error
                ? error.message
                : "unknown",
          });
          this.rejectUpgrade(
            socket,
            500,
            "Internal Server Error",
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.warn({
          msg: "realtime.authorization_failed",
          error:
            error instanceof Error
              ? error.message
              : "unknown",
        });
        this.rejectUpgrade(
          socket,
          503,
          "Service Unavailable",
        );
      });
  };

  private async authorizeUpgrade(
    request: IncomingMessage,
    url: URL,
  ): Promise<
    | {
        ok: true;
        userId: string;
        installationId: string;
        connectionId: string;
      }
    | {
        ok: false;
        status: number;
        reason: string;
      }
  > {
    if (request.headers.origin !== this.config.webOrigin) {
      return {
        ok: false,
        status: 403,
        reason: "Forbidden",
      };
    }

    const protocolVersion = Number(
      url.searchParams.get("protocolVersion"),
    );
    if (protocolVersion !== REALTIME_PROTOCOL_VERSION) {
      return {
        ok: false,
        status: 400,
        reason: "Bad Request",
      };
    }

    const parsedInstallation =
      clientInstallationIdSchema.safeParse(
        url.searchParams.get("installationId"),
      );
    if (!parsedInstallation.success) {
      return {
        ok: false,
        status: 400,
        reason: "Bad Request",
      };
    }

    const session = await this.auth.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) {
      return {
        ok: false,
        status: 401,
        reason: "Unauthorized",
      };
    }
    if (!session.user.emailVerified) {
      return {
        ok: false,
        status: 403,
        reason: "Forbidden",
      };
    }

    await this.handles.activateVerified(session.user.id);
    const handle = await this.handles.readForUser(
      session.user.id,
    );
    if (!handle || handle.status !== "ACTIVE") {
      return {
        ok: false,
        status: 403,
        reason: "Forbidden",
      };
    }

    const active = await this.installations.isActiveOwned(
      session.user.id,
      parsedInstallation.data,
    );
    if (!active) {
      return {
        ok: false,
        status: 404,
        reason: "Not Found",
      };
    }

    return {
      ok: true,
      userId: session.user.id,
      installationId: parsedInstallation.data,
      connectionId: this.realtime.createConnectionId(),
    };
  }

  private acceptConnection(
    socket: WebSocket,
    request: IncomingMessage,
    authorized: {
      userId: string;
      installationId: string;
      connectionId: string;
    },
  ): void {
    const state: ConnectionState = {
      connectionId: authorized.connectionId,
      userId: authorized.userId,
      installationId: authorized.installationId,
      socket,
      requestHeaders: { ...request.headers },
      unsubscribe: () => undefined,
      heartbeatTimer: null,
      expectedHeartbeatId: null,
      heartbeatSentAt: null,
      frameWindowStartedAt: Date.now(),
      frameCount: 0,
      closed: false,
    };

    this.connections.set(state.connectionId, state);
    state.unsubscribe = this.realtime.subscribe(
      state.userId,
      (event) => {
        this.sendFrame(state, event);
      },
    );

    socket.on("message", (data, isBinary) => {
      this.handleClientMessage(state, data, isBinary);
    });
    socket.once("close", () => {
      this.cleanupConnection(state);
    });
    socket.once("error", () => {
      this.cleanupConnection(state);
    });

    const hello = realtimeHelloFrameSchema.parse({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      frameType: "HELLO",
      connectionId: state.connectionId,
      installationId: state.installationId,
      heartbeatIntervalMs:
        this.config.realtimeHeartbeatIntervalMs,
      serverTime: new Date().toISOString(),
    });
    this.sendFrame(state, hello);
    this.scheduleHeartbeat(state);

    this.logger.log({
      msg: "realtime.connection_opened",
      connectionId: state.connectionId,
      userId: state.userId,
      installationId: state.installationId,
    });
  }

  private handleClientMessage(
    state: ConnectionState,
    data: RawData,
    isBinary: boolean,
  ): void {
    if (state.closed) {
      return;
    }
    if (isBinary) {
      this.close(
        state,
        CLOSE_INVALID_FRAME,
        "invalid_frame",
      );
      return;
    }
    if (!this.consumeClientFrameBudget(state)) {
      this.close(
        state,
        CLOSE_RATE_LIMITED,
        "rate_limited",
      );
      return;
    }

    const text = rawDataToUtf8(data);
    if (
      Buffer.byteLength(text, "utf8") >
      this.config.realtimeFrameBytesMax
    ) {
      this.close(
        state,
        CLOSE_INVALID_FRAME,
        "invalid_frame",
      );
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      this.close(
        state,
        CLOSE_INVALID_FRAME,
        "invalid_frame",
      );
      return;
    }

    const parsed = realtimeClientFrameSchema.safeParse(
      payload,
    );
    if (
      !parsed.success ||
      parsed.data.heartbeatId !==
        state.expectedHeartbeatId
    ) {
      this.close(
        state,
        CLOSE_INVALID_FRAME,
        "invalid_frame",
      );
      return;
    }

    state.expectedHeartbeatId = null;
    state.heartbeatSentAt = null;
  }

  private consumeClientFrameBudget(
    state: ConnectionState,
  ): boolean {
    const now = Date.now();
    if (
      now - state.frameWindowStartedAt >=
      60_000
    ) {
      state.frameWindowStartedAt = now;
      state.frameCount = 0;
    }
    state.frameCount += 1;
    return (
      state.frameCount <=
      this.config.realtimeClientFramesPerMinute
    );
  }

  private scheduleHeartbeat(
    state: ConnectionState,
  ): void {
    state.heartbeatTimer = setTimeout(() => {
      void this.heartbeat(state);
    }, this.config.realtimeHeartbeatIntervalMs);
  }

  private async heartbeat(
    state: ConnectionState,
  ): Promise<void> {
    if (state.closed) {
      return;
    }

    const now = Date.now();
    if (
      state.expectedHeartbeatId &&
      state.heartbeatSentAt !== null &&
      now - state.heartbeatSentAt >=
        this.config.realtimeHeartbeatTimeoutMs
    ) {
      this.close(
        state,
        CLOSE_HEARTBEAT_TIMEOUT,
        "heartbeat_timeout",
      );
      return;
    }

    const valid = await this.revalidateConnection(state);
    if (!valid.session) {
      this.close(
        state,
        CLOSE_SESSION_INVALID,
        "session_invalid",
      );
      return;
    }
    if (!valid.installation) {
      this.close(
        state,
        CLOSE_INSTALLATION_INACTIVE,
        "installation_inactive",
      );
      return;
    }

    if (!state.expectedHeartbeatId) {
      const heartbeatId =
        this.realtime.createConnectionId();
      const frame = realtimeHeartbeatFrameSchema.parse({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        frameType: "HEARTBEAT",
        heartbeatId,
        sentAt: new Date().toISOString(),
      });
      state.expectedHeartbeatId = heartbeatId;
      state.heartbeatSentAt = now;
      this.sendFrame(state, frame);
    }

    this.scheduleHeartbeat(state);
  }

  private async revalidateConnection(
    state: ConnectionState,
  ): Promise<{
    session: boolean;
    installation: boolean;
  }> {
    try {
      const session = await this.auth.auth.api.getSession({
        headers: fromNodeHeaders(state.requestHeaders),
      });
      if (
        !session ||
        session.user.id !== state.userId ||
        !session.user.emailVerified
      ) {
        return {
          session: false,
          installation: false,
        };
      }

      const handle = await this.handles.readForUser(
        state.userId,
      );
      if (!handle || handle.status !== "ACTIVE") {
        return {
          session: false,
          installation: false,
        };
      }

      return {
        session: true,
        installation:
          await this.installations.isActiveOwned(
            state.userId,
            state.installationId,
          ),
      };
    } catch (error: unknown) {
      this.logger.warn({
        msg: "realtime.revalidation_failed",
        connectionId: state.connectionId,
        error:
          error instanceof Error
            ? error.message
            : "unknown",
      });
      return {
        session: false,
        installation: false,
      };
    }
  }

  private sendFrame(
    state: ConnectionState,
    frame: RealtimeServerFrame | RealtimeEventEnvelope,
  ): void {
    if (
      state.closed ||
      state.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const parsed = realtimeServerFrameSchema.parse(frame);
    state.socket.send(JSON.stringify(parsed));
  }

  private close(
    state: ConnectionState,
    code: number,
    reason: string,
  ): void {
    if (state.closed) {
      return;
    }
    state.closed = true;
    try {
      state.socket.close(code, reason);
    } finally {
      this.cleanupConnection(state);
    }
  }

  private cleanupConnection(
    state: ConnectionState,
  ): void {
    if (!this.connections.has(state.connectionId)) {
      return;
    }
    if (state.heartbeatTimer) {
      clearTimeout(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    state.unsubscribe();
    this.connections.delete(state.connectionId);
    this.releaseInstallationConnection(
      state.installationId,
      state.connectionId,
    );
    if (!state.closed) {
      state.closed = true;
    }

    this.logger.log({
      msg: "realtime.connection_closed",
      connectionId: state.connectionId,
      userId: state.userId,
      installationId: state.installationId,
    });
  }

  private reserveInstallationConnection(
    installationId: string,
    connectionId: string,
  ): boolean {
    const current =
      this.installationConnections.get(
        installationId,
      ) ?? new Set<string>();
    if (
      current.size >=
      this.config.realtimeMaxConnectionsPerInstallation
    ) {
      return false;
    }
    current.add(connectionId);
    this.installationConnections.set(
      installationId,
      current,
    );
    return true;
  }

  private releaseInstallationConnection(
    installationId: string,
    connectionId: string,
  ): void {
    const current =
      this.installationConnections.get(installationId);
    current?.delete(connectionId);
    if (current?.size === 0) {
      this.installationConnections.delete(
        installationId,
      );
    }
  }

  private rejectUpgrade(
    socket: Duplex,
    status: number,
    reason: string,
  ): void {
    if (socket.destroyed) {
      return;
    }
    socket.end(
      `HTTP/1.1 ${status} ${reason}\r\n` +
        "Connection: close\r\n" +
        "Content-Length: 0\r\n" +
        "\r\n",
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.attachedServer) {
      this.attachedServer.off(
        "upgrade",
        this.handleUpgrade,
      );
      this.attachedServer = null;
    }

    for (const state of this.connections.values()) {
      this.close(state, 1001, "server_shutdown");
    }
    this.connections.clear();
    this.installationConnections.clear();

    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });
  }
}

function rawDataToUtf8(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return data.toString("utf8");
}
