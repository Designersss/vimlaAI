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
    position: bigint,
  ): string {
    assertPosition(position);
    const payload = `${SYNC_PROTOCOL_VERSION}:${position.toString()}`;
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
  ): bigint {
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

    const match = /^1:(0|[1-9]\d{0,18})$/.exec(
      payload,
    );
    if (!match) {
      throw new SyncCursorDecodeError();
    }
    const position = BigInt(match[1]);
    assertPosition(position);
    return position;
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

function assertPosition(
  position: bigint,
): void {
  if (
    position < 0n ||
    position > MAX_BIGINT_64
  ) {
    throw new SyncCursorDecodeError();
  }
}
