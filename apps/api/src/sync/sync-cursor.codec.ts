import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  SYNC_PROTOCOL_VERSION,
  syncCursorSchema,
} from "@vimla/contracts";
import {
  API_CONFIG,
  type ApiRuntimeConfig,
} from "../config/api-config.js";

const MAX_BIGINT_64 = 9_223_372_036_854_775_807n;
const CURSOR_DOMAIN = "vimla-sync-cursor-v1";

export interface SyncCursorState {
  position: bigint;
  snapshotHead: bigint;
}

export class SyncCursorDecodeError extends Error {
  constructor() {
    super("Invalid sync cursor");
    this.name = "SyncCursorDecodeError";
  }
}

@Injectable()
export class SyncCursorCodec {
  private readonly secret: string;

  constructor(
    @Inject(API_CONFIG)
    config: ApiRuntimeConfig,
  ) {
    this.secret = config.betterAuthSecret;
  }

  encode(
    userId: string,
    state: SyncCursorState,
  ): string {
    assertCursorState(state);
    const payload =
      `${SYNC_PROTOCOL_VERSION}:${state.position.toString()}:${state.snapshotHead.toString()}`;
    const encodedPayload =
      Buffer.from(payload, "utf8").toString("base64url");
    const signature = this.sign(userId, payload);
    return syncCursorSchema.parse(
      `${encodedPayload}.${signature}`,
    );
  }

  decode(
    userId: string,
    cursor: string,
  ): SyncCursorState {
    if (!syncCursorSchema.safeParse(cursor).success) {
      throw new SyncCursorDecodeError();
    }
    const parts = cursor.split(".");
    if (parts.length !== 2) {
      throw new SyncCursorDecodeError();
    }
    const [encodedPayload, encodedSignature] =
      parts as [string, string];

    let payload: string;
    let supplied: Buffer;
    try {
      payload = Buffer.from(
        encodedPayload,
        "base64url",
      ).toString("utf8");
      supplied = Buffer.from(
        encodedSignature,
        "base64url",
      );
    } catch {
      throw new SyncCursorDecodeError();
    }

    const expected = Buffer.from(
      this.sign(userId, payload),
      "base64url",
    );
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new SyncCursorDecodeError();
    }

    const match =
      /^1:(0|[1-9]\d{0,18}):(0|[1-9]\d{0,18})$/.exec(
        payload,
      );
    if (!match) {
      throw new SyncCursorDecodeError();
    }
    const positionText = match[1];
    const snapshotHeadText = match[2];
    if (
      positionText === undefined ||
      snapshotHeadText === undefined
    ) {
      throw new SyncCursorDecodeError();
    }
    const state = {
      position: BigInt(positionText),
      snapshotHead: BigInt(snapshotHeadText),
    };
    assertCursorState(state);
    return state;
  }

  private sign(
    userId: string,
    payload: string,
  ): string {
    return createHmac("sha256", this.secret)
      .update(CURSOR_DOMAIN)
      .update("\0")
      .update(userId)
      .update("\0")
      .update(payload)
      .digest("base64url");
  }
}

function assertCursorState(
  state: SyncCursorState,
): void {
  if (
    state.position < 0n ||
    state.position > MAX_BIGINT_64 ||
    state.snapshotHead < 0n ||
    state.snapshotHead > MAX_BIGINT_64 ||
    state.snapshotHead < state.position
  ) {
    throw new SyncCursorDecodeError();
  }
}
