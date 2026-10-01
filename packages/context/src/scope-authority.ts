import type { PrismaClient } from "@vimla/database";
import type {
  ContextReadScope,
  ContextWriteScope,
} from "./policy.js";

export interface ContextScopeAuthorityAdapter<
  TKind extends ContextReadScope["kind"] =
    ContextReadScope["kind"],
> {
  readonly kind: TKind;
  canRead(
    userId: string,
    scope: Extract<ContextReadScope, { kind: TKind }>,
  ): Promise<boolean>;
  canWrite(
    userId: string,
    scope: Extract<ContextWriteScope, { kind: TKind }>,
  ): Promise<boolean>;
}

export class ContextScopeAuthorityRegistry {
  private readonly adapters = new Map<
    ContextReadScope["kind"],
    ContextScopeAuthorityAdapter
  >();

  constructor(
    adapters: readonly ContextScopeAuthorityAdapter[],
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.kind)) {
        throw new Error(
          `Duplicate context scope authority adapter for ${adapter.kind}`,
        );
      }
      this.adapters.set(adapter.kind, adapter);
    }
  }

  canRead(
    userId: string,
    scope: ContextReadScope,
  ): Promise<boolean> {
    const adapter = this.adapters.get(scope.kind);
    if (!adapter) return Promise.resolve(false);
    return adapter.canRead(
      userId,
      scope as never,
    );
  }

  canWrite(
    userId: string,
    scope: ContextWriteScope,
  ): Promise<boolean> {
    const adapter = this.adapters.get(scope.kind);
    if (!adapter) return Promise.resolve(false);
    return adapter.canWrite(
      userId,
      scope as never,
    );
  }
}

export class PersonalContextScopeAuthorityAdapter
  implements
    ContextScopeAuthorityAdapter<"PERSONAL">
{
  readonly kind = "PERSONAL" as const;

  canRead(
    userId: string,
    scope: Extract<
      ContextReadScope,
      { kind: "PERSONAL" }
    >,
  ): Promise<boolean> {
    return Promise.resolve(
      scope.ownerUserId === userId,
    );
  }

  canWrite(
    userId: string,
    scope: Extract<
      ContextWriteScope,
      { kind: "PERSONAL" }
    >,
  ): Promise<boolean> {
    return Promise.resolve(
      scope.ownerUserId === userId,
    );
  }
}

export class ProjectContextScopeAuthorityAdapter
  implements
    ContextScopeAuthorityAdapter<"PROJECT">
{
  readonly kind = "PROJECT" as const;

  constructor(private readonly db: PrismaClient) {}

  async canRead(
    userId: string,
    scope: Extract<
      ContextReadScope,
      { kind: "PROJECT" }
    >,
  ): Promise<boolean> {
    return Boolean(
      await this.db.project.findFirst({
        where: {
          id: scope.projectId,
          OR: [
            { ownerUserId: userId },
            {
              members: {
                some: { userId },
              },
            },
          ],
        },
        select: { id: true },
      }),
    );
  }

  canWrite(
    userId: string,
    scope: Extract<
      ContextWriteScope,
      { kind: "PROJECT" }
    >,
  ): Promise<boolean> {
    return this.canRead(userId, scope);
  }
}

export class DirectChatContextScopeAuthorityAdapter
  implements
    ContextScopeAuthorityAdapter<"DIRECT_CHAT">
{
  readonly kind = "DIRECT_CHAT" as const;

  constructor(private readonly db: PrismaClient) {}

  async canRead(
    userId: string,
    scope: Extract<
      ContextReadScope,
      { kind: "DIRECT_CHAT" }
    >,
  ): Promise<boolean> {
    return Boolean(
      await this.db.directConversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId:
              scope.directConversationId,
            userId,
          },
        },
        select: { id: true },
      }),
    );
  }

  canWrite(
    userId: string,
    scope: Extract<
      ContextWriteScope,
      { kind: "DIRECT_CHAT" }
    >,
  ): Promise<boolean> {
    return this.canRead(userId, scope);
  }
}

export function createContextScopeAuthorityRegistry(
  db: PrismaClient,
): ContextScopeAuthorityRegistry {
  return new ContextScopeAuthorityRegistry([
    new PersonalContextScopeAuthorityAdapter(),
    new ProjectContextScopeAuthorityAdapter(db),
    new DirectChatContextScopeAuthorityAdapter(db),
  ]);
}
