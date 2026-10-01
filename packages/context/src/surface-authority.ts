import type {
  CommunicationSurfaceKind,
} from "@vimla/contracts";

export interface ResolveSurfaceAuthorityInput {
  actorUserId: string;
  surfaceId: string;
}

export interface SurfaceIdentityResolver {
  resolveKind(
    surfaceId: string,
  ): Promise<CommunicationSurfaceKind | null>;
}

export interface SurfaceAuthorityAdapter<TResult> {
  readonly kind: CommunicationSurfaceKind;
  resolve(
    input: ResolveSurfaceAuthorityInput,
  ): Promise<TResult>;
}

export class SurfaceAuthorityRegistry<TResult> {
  private readonly adapters =
    new Map<
      CommunicationSurfaceKind,
      SurfaceAuthorityAdapter<TResult>
    >();

  constructor(
    private readonly identities: SurfaceIdentityResolver,
    adapters: readonly SurfaceAuthorityAdapter<TResult>[],
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.kind)) {
        throw new Error(
          `Duplicate surface authority adapter for ${adapter.kind}`,
        );
      }
      this.adapters.set(adapter.kind, adapter);
    }
  }

  async resolve(
    input: ResolveSurfaceAuthorityInput,
  ): Promise<TResult> {
    const kind =
      await this.identities.resolveKind(input.surfaceId);
    if (!kind) {
      throw new SurfaceIdentityUnavailableError(
        input.surfaceId,
      );
    }

    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new SurfaceAuthorityUnavailableError(kind);
    }
    return adapter.resolve(input);
  }
}

export class SurfaceIdentityUnavailableError extends Error {
  constructor(readonly surfaceId: string) {
    super(
      `Communication surface identity is unavailable for ${surfaceId}`,
    );
    this.name = "SurfaceIdentityUnavailableError";
  }
}

export class SurfaceAuthorityUnavailableError extends Error {
  constructor(
    readonly kind: CommunicationSurfaceKind,
  ) {
    super(
      `Surface authority adapter is unavailable for ${kind}`,
    );
    this.name = "SurfaceAuthorityUnavailableError";
  }
}
