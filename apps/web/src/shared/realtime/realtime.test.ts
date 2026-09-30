import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  REALTIME_PROTOCOL_VERSION,
  type RealtimeEventEnvelope,
} from "@vimla/contracts";
import {
  realtimeWebSocketUrl,
  subscribeRealtime,
} from "./realtime";

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage:
    | ((event: { data: unknown }) => void)
    | null = null;
  onclose:
    | ((event: { code: number }) => void)
    | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];
  readonly closes: Array<{
    code?: number;
    reason?: string;
  }> = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({
      data: JSON.stringify(payload),
    });
  }

  emitClose(code: number): void {
    this.onclose?.({ code });
  }
}

describe("Web realtime transport", () => {
  it("builds a versioned WebSocket URL", () => {
    const installationId = randomUUID();
    const url = new URL(
      realtimeWebSocketUrl(
        installationId.toUpperCase(),
        "https://api.example.test/base/",
      ),
    );
    expect(url.protocol).toBe("wss:");
    expect(url.pathname).toBe(
      "/base/v1/realtime",
    );
    expect(
      url.searchParams.get("protocolVersion"),
    ).toBe(String(REALTIME_PROTOCOL_VERSION));
    expect(
      url.searchParams.get("installationId"),
    ).toBe(installationId);
  });

  it("answers heartbeats and forwards strict events", () => {
    const socket = new FakeSocket();
    const events: RealtimeEventEnvelope[] = [];
    const onOpen = vi.fn();
    const installationId = randomUUID();
    const stop = subscribeRealtime({
      installationId,
      onEvent: (event) => events.push(event),
      onOpen,
      socketFactory: () => socket,
    });

    socket.emitMessage({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      frameType: "HELLO",
      connectionId: randomUUID(),
      installationId,
      heartbeatIntervalMs: 20_000,
      serverTime: new Date().toISOString(),
    });
    expect(onOpen).toHaveBeenCalledTimes(1);

    const heartbeatId = randomUUID();
    socket.emitMessage({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      frameType: "HEARTBEAT",
      heartbeatId,
      sentAt: new Date().toISOString(),
    });
    expect(JSON.parse(socket.sent[0] ?? "{}")).toEqual({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      frameType: "PONG",
      heartbeatId,
    });

    const conversationId = randomUUID();
    const event = {
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      frameType: "EVENT",
      eventId: randomUUID(),
      eventType: "DIRECT_MESSAGE_CREATED",
      durability: "DURABLE_HINT",
      scope: {
        kind: "DIRECT_CHAT",
        id: conversationId,
      },
      occurredAt: new Date().toISOString(),
      payload: {
        conversationId,
        messageId: randomUUID(),
      },
    } as const;
    socket.emitMessage(event);
    expect(events).toEqual([event]);

    stop();
    expect(socket.closes.at(-1)).toEqual({
      code: 1000,
      reason: "client_close",
    });
  });

  it("rejects a HELLO bound to another installation", () => {
    const socket = new FakeSocket();
    const installationId = randomUUID();
    const onOpen = vi.fn();
    subscribeRealtime({
      installationId,
      onEvent: () => undefined,
      onOpen,
      socketFactory: () => socket,
    });

    socket.emitMessage({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      frameType: "HELLO",
      connectionId: randomUUID(),
      installationId: randomUUID(),
      heartbeatIntervalMs: 20_000,
      serverTime: new Date().toISOString(),
    });

    expect(onOpen).not.toHaveBeenCalled();
    expect(socket.closes.at(-1)).toEqual({
      code: 1002,
      reason: "installation_mismatch",
    });
  });

  it("reconnects with bounded backoff but stops on terminal close", () => {
    const sockets: FakeSocket[] = [];
    const scheduled: Array<{
      callback: () => void;
      delay: number;
    }> = [];
    const socketFactory = vi.fn(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const stop = subscribeRealtime({
      installationId: randomUUID(),
      onEvent: () => undefined,
      socketFactory,
      setTimeoutFn: (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length as unknown as ReturnType<
          typeof setTimeout
        >;
      },
      clearTimeoutFn: () => undefined,
    });

    sockets[0]?.emitClose(1006);
    expect(scheduled[0]?.delay).toBe(500);
    scheduled[0]?.callback();
    expect(socketFactory).toHaveBeenCalledTimes(2);

    sockets[1]?.emitClose(1006);
    expect(scheduled[1]?.delay).toBe(1_000);
    scheduled[1]?.callback();
    expect(socketFactory).toHaveBeenCalledTimes(3);

    sockets[2]?.emitClose(4003);
    expect(scheduled).toHaveLength(2);

    stop();
  });

  it("closes on malformed server frames", () => {
    const socket = new FakeSocket();
    subscribeRealtime({
      installationId: randomUUID(),
      onEvent: () => undefined,
      socketFactory: () => socket,
    });
    socket.emitMessage({
      protocolVersion: 99,
      frameType: "EVENT",
    });
    expect(socket.closes.at(-1)).toEqual({
      code: 1002,
      reason: "invalid_server_frame",
    });
  });
});
