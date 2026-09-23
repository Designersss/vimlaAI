import { ArtifactNotFoundError, ArtifactService } from "@vimla/artifacts";
import type { PrismaClient } from "@vimla/database";
import type { ContextSnapshotItemInput } from "./types.js";
import type { ContextSourceScope } from "./policy.js";
import { isKnownContextClassification } from "./policy.js";
import { canonicalJson } from "./fingerprint.js";
import { containsSensitiveContextData } from "./packer.js";
import { semanticHash } from "./semantic-text.js";

export interface SemanticSourceReference {
  kind: string;
  sourceId: string;
}
export interface SemanticDocument {
  item: ContextSnapshotItemInput;
  scope: ContextSourceScope;
  text: string;
  fingerprint: string;
  occurredAt: Date;
  conversationId?: string;
}
/** Future memory/L2/file adapters must resolve authoritative provenance and ACL here, not return provider text. */
export interface SemanticSourceResolver {
  load(
    reference: SemanticSourceReference,
    actorUserId: string,
  ): Promise<SemanticDocument | null>;
}
export class PersistedSemanticSources implements SemanticSourceResolver {
  constructor(private readonly db: PrismaClient) {}
  async load(
    ref: SemanticSourceReference,
    actorUserId: string,
  ): Promise<SemanticDocument | null> {
    const personal: ContextSourceScope = {
      kind: "PERSONAL",
      ownerUserId: actorUserId,
    };
    if (ref.kind === "MESSAGE") {
      const row = await this.db.message.findFirst({
        where: {
          id: ref.sourceId,
          status: "COMPLETE",
          role: { in: ["USER", "ASSISTANT"] },
          conversation: {
            userId: actorUserId,
            kind: { in: ["CHAT", "OPERATOR"] },
          },
        },
      });
      if (!row) return null;
      return document(
        {
          sourceType: "MESSAGE",
          sourceId: row.id,
          sourceVersion: row.updatedAt.toISOString(),
          classification: "PRIVATE",
          contentRef: `vimla://messages/${row.id}`,
          metadata: {
            content: row.content,
            role: row.role,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
          },
        },
        personal,
        row.content,
        row.createdAt,
        row.conversationId,
      );
    }
    if (ref.kind === "NOTE") {
      const row = await this.db.workspaceObject.findFirst({
        where: {
          id: ref.sourceId,
          kind: "NOTE",
          scopeType: "PERSONAL",
          personalOwnerUserId: actorUserId,
          deletedAt: null,
        },
        include: { note: true },
      });
      if (!row?.note) return null;
      return document(
        {
          sourceType: "WORKSPACE_OBJECT",
          sourceId: row.id,
          sourceVersion: row.updatedAt.toISOString(),
          classification: "PRIVATE",
          contentRef: `vimla://workspace/${row.id}`,
          metadata: {
            kind: "NOTE",
            title: row.note.title,
            content: row.note.contentMarkdown,
          },
        },
        personal,
        row.note.title + "\n" + row.note.contentMarkdown,
        row.updatedAt,
      );
    }
    if (ref.kind === "PROJECT") {
      const row = await this.db.project.findFirst({
        where: {
          id: ref.sourceId,
          OR: [
            { ownerUserId: actorUserId },
            { members: { some: { userId: actorUserId } } },
          ],
        },
      });
      if (!row) return null;
      return document(
        {
          sourceType: "PROJECT",
          sourceId: row.id,
          sourceVersion: row.updatedAt.toISOString(),
          classification: "PRIVATE",
          contentRef: `vimla://projects/${row.id}`,
          metadata: { name: row.name, description: row.description },
        },
        { kind: "PROJECT", projectId: row.id },
        row.name + "\n" + (row.description ?? ""),
        row.updatedAt,
      );
    }
    if (ref.kind === "ARTIFACT") {
      const row = await this.db.artifact.findFirst({
        where: {
          id: ref.sourceId,
          OR: [
            { creatorInvocation: { plan: { userId: actorUserId } } },
            {
              accessGrants: {
                some: {
                  granteeUserId: actorUserId,
                  permission: "READ",
                  revokedAt: null,
                },
              },
            },
          ],
        },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (
        !row ||
        !isKnownContextClassification(row.classification) ||
        row.classification === "RESTRICTED"
      )
        return null;
      const version = row.versions[0];
      if (!version) return null;
      try {
        const value = await new ArtifactService(this.db).readVersion({
          actorUserId,
          artifactVersionId: version.id,
        });
        if (value.content.kind !== "INLINE_JSON") return null;
        const content = canonicalJson(value.content.value);
        return document(
          {
            sourceType: "ARTIFACT",
            sourceId: row.id,
            sourceVersion: String(version.version),
            classification: row.classification,
            contentRef: `vimla://artifacts/${row.id}/versions/${version.id}`,
            metadata: {
              outputName: row.outputName,
              type: row.type,
              metadata: row.metadata,
              inlineContentJson: content,
              latestVersion: {
                version: version.version,
                fingerprint: version.fingerprint,
                createdAt: version.createdAt.toISOString(),
              },
            },
          },
          personal,
          row.outputName + "\n" + content,
          version.createdAt,
        );
      } catch (error: unknown) {
        if (error instanceof ArtifactNotFoundError) return null;
        throw error;
      }
    }
    // No Direct Chat, decrypted handoff, synthetic memory, or unknown file loading.
    return null;
  }
}
function document(
  item: ContextSnapshotItemInput,
  scope: ContextSourceScope,
  text: string,
  occurredAt: Date,
  conversationId?: string,
): SemanticDocument | null {
  if (
    containsSensitiveContextData(item.metadata) ||
    item.classification === "RESTRICTED"
  )
    return null;
  return {
    item,
    scope,
    text,
    occurredAt,
    ...(conversationId ? { conversationId } : {}),
    fingerprint: semanticHash(
      canonicalJson({
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceVersion: item.sourceVersion ?? null,
        classification: item.classification,
        metadata: item.metadata ?? null,
      }),
    ),
  };
}
