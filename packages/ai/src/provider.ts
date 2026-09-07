export type AiCapability =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "embedding"
  | "tool_use";

export type AiProviderId = string;

/**
 * Vimla-owned provider adapter contract.
 * ProxyAPI will be the first implementation in a later phase; it must not leak
 * into product/billing layers.
 */
export interface AiProvider {
  readonly id: AiProviderId;
  readonly displayName: string;
  readonly capabilities: readonly AiCapability[];
}

/**
 * Application-facing gateway. Routing stays separate from UI and adapters.
 * Provider calls must only happen after a usage reservation exists (Phase 2+).
 */
export interface AiGateway {
  readonly providers: readonly AiProvider[];
}

export const AI_GATEWAY_BOUNDARY = "AiGateway -> AiProvider -> adapter" as const;
