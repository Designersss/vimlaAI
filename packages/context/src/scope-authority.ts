import type { PrismaClient } from "@vimla/database";
import type { ContextReadScope } from "./policy.js";

export interface ContextScopeAuthorityAdapter {
  readonly kind: ContextReadScope["kind"];
  canRead(
    userId: string,
    scope: ContextReadScope,
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
    return adapter
      ? adapter.canRead(userId, scope)
      : Promise.resolve(false);
  }

}

export class PersonalContextScopeAuthorityAdapter
  implements ContextScopeAuthorityAdapter
{
  readonly kind = "PERSONAL" as const;

  canRead(
    userId: string,
    scope: ContextReadScope,
  ): Promise<boolean> {
    return Promise.resolve(
      scope.kind === "PERSONAL" &&
        scope.ownerUserId === userId,
    );
  }

}

export class ProjectContextScopeAuthorityAdapter
  implements ContextScopeAuthorityAdapter
{
  readonly kind = "PROJECT" as const;

  constructor(private readonly db: PrismaClient) {}

  async canRead(
    userId: string,
    scope: ContextReadScope,
  ): Promise<boolean> {
    if (scope.kind !== "PROJECT") return false;
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

}

export class DirectChatContextScopeAuthorityAdapter
  implements ContextScopeAuthorityAdapter
{
  readonly kind = "DIRECT_CHAT" as const;

  constructor(private readonly db: PrismaClient) {}

  async canRead(
    userId: string,
    scope: ContextReadScope,
  ): Promise<boolean> {
    if (scope.kind !== "DIRECT_CHAT") return false;
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
