import type { SemanticSearchService } from "./semantic-search.js";
import { ArtifactNotFoundError, ArtifactService } from "@vimla/artifacts";
import { Prisma, type PrismaClient } from "@vimla/database";
import {
  ContextAccessDeniedError,
  ContextConflictError,
  ContextNotFoundError,
  ContextValidationError,
} from "./errors.js";
import {
  isKnownContextClassification,
  type ContextSourceScope,
} from "./policy.js";
import {
  conservativeTokensFromByteCount,
  estimateConservativeTokens as estimateTokens,
} from "./token-estimate.js";
import type {
  ContextClassification,
  ContextSnapshotItemInput,
} from "./types.js";

export type ContextRetrievalSourceKind =
  | "IMMEDIATE"
  | "L1_RAW"
  | "L2_COMPACTED"
  | "OLDER_HISTORY"
  | "CROSS_CONVERSATION"
  | "PERSONAL_MEMORY"
  | "PROJECT_MEMORY"
  | "ENTITY"
  | "WORKSPACE_OBJECT"
  | "PROJECT_OBJECT"
  | "ARTIFACT"
  | "FILE_METADATA"
  | "DIRECT_REFERENCE";

export type ContextSourceAuthority =
  | "AUTHORITATIVE"
  | "RAW"
  | "DERIVED";

export interface ContextCandidate {
  item: ContextSnapshotItemInput;
  sourceKind: ContextRetrievalSourceKind;
  sourceScope: ContextSourceScope;
  reason: string;
  lexicalScore: number;
  semanticScore?: number;
  hybridScore?: number;
  directReference: boolean;
  currentSurface: boolean;
  currentProject: boolean;
  authority: ContextSourceAuthority;
  occurredAt: string | null;
  estimatedTokens: number;
  rawHistoryTokens?: number;
  stale?: boolean;
  superseded?: boolean;
}

export interface ContextCandidateSet {
  query: string;
  candidates: ContextCandidate[];
}

export interface ContextRetrievalProviderInput {
  actorUserId: string;
  planId: string;
  query: string;
  conversationId: string;
  sourceMessageId: string;
  sourceMessageCreatedAt: string;
  currentProjectId?: string | null;
}

export interface ContextRetrievalProvider {
  retrieve(
    input: ContextRetrievalProviderInput,
  ): Promise<readonly ContextCandidate[]>;
}

export interface ContextRetrievalOptions {
  l1RawLimit?: number;
  olderHistoryScanLimit?: number;
  crossConversationScanLimit?: number;
  relevantHistoryLimit?: number;
  workspaceScanLimit?: number;
  workspaceLimit?: number;
  projectScanLimit?: number;
  projectLimit?: number;
  artifactScanLimit?: number;
  artifactLimit?: number;
  maxCandidates?: number;
}

const DEFAULTS = {
  l1RawLimit: 24,
  olderHistoryScanLimit: 512,
  crossConversationScanLimit: 320,
  relevantHistoryLimit: 12,
  workspaceScanLimit: 100,
  workspaceLimit: 16,
  projectScanLimit: 50,
  projectLimit: 8,
  artifactScanLimit: 50,
  artifactLimit: 8,
  maxCandidates: 128,
} as const;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "what",
  "when",
  "where",
  "how",
  "which",
  "about",
  "have",
  "has",
  "had",
  "was",
  "were",
  "are",
  "you",
  "your",
  "our",
  "can",
  "could",
  "would",
  "should",
  "как",
  "что",
  "это",
  "для",
  "про",
  "при",
  "или",
  "его",
  "её",
  "она",
  "они",
  "мы",
  "вы",
  "мне",
  "нам",
  "был",
  "была",
  "были",
  "есть",
  "уже",
  "ещё",
  "еще",
]);

export class ContextRetrievalService {
  private readonly options: Required<ContextRetrievalOptions>;
  private readonly artifacts: ArtifactService;

  constructor(
    private readonly db: PrismaClient,
    private readonly providers: readonly ContextRetrievalProvider[] = [],
    options: ContextRetrievalOptions = {},
    private readonly semanticSearch?: SemanticSearchService,
  ) {
    this.artifacts = new ArtifactService(db);
    this.options = {
      l1RawLimit: options.l1RawLimit ?? DEFAULTS.l1RawLimit,
      olderHistoryScanLimit:
        options.olderHistoryScanLimit ?? DEFAULTS.olderHistoryScanLimit,
      crossConversationScanLimit:
        options.crossConversationScanLimit ??
        DEFAULTS.crossConversationScanLimit,
      relevantHistoryLimit:
        options.relevantHistoryLimit ?? DEFAULTS.relevantHistoryLimit,
      workspaceScanLimit:
        options.workspaceScanLimit ?? DEFAULTS.workspaceScanLimit,
      workspaceLimit: options.workspaceLimit ?? DEFAULTS.workspaceLimit,
      projectScanLimit:
        options.projectScanLimit ?? DEFAULTS.projectScanLimit,
      projectLimit: options.projectLimit ?? DEFAULTS.projectLimit,
      artifactScanLimit:
        options.artifactScanLimit ?? DEFAULTS.artifactScanLimit,
      artifactLimit: options.artifactLimit ?? DEFAULTS.artifactLimit,
      maxCandidates: options.maxCandidates ?? DEFAULTS.maxCandidates,
    };
  }

  async retrieveForExecutionPlan(input: {
    actorUserId: string;
    planId: string;
  }): Promise<ContextCandidateSet> {
    const plan = await this.db.executionPlan.findFirst({
      where: {
        id: input.planId,
        userId: input.actorUserId,
      },
      select: {
        status: true,
        message: {
          select: {
            id: true,
            role: true,
            content: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            conversation: {
              select: {
                id: true,
                projectId: true,
                title: true,
                kind: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            updatedAt: true,
            preference: {
              select: {
                locale: true,
                timezone: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });
    if (!plan) {
      throw new ContextNotFoundError("Execution plan not found");
    }
    if (plan.status !== "PLANNING" && plan.status !== "PLANNED") {
      throw new ContextConflictError(
        "Context snapshot must be frozen before execution starts",
      );
    }

    const sourceMessage = plan.message;
    const focusedProjectId =
      sourceMessage.conversation.projectId;
    const currentProject = focusedProjectId
      ? await this.db.project.findFirst({
          where: {
            id: focusedProjectId,
            OR: [
              { ownerUserId: input.actorUserId },
              {
                members: {
                  some: { userId: input.actorUserId },
                },
              },
            ],
          },
          select: {
            id: true,
            updatedAt: true,
          },
        })
      : null;
    const currentProjectId = currentProject?.id ?? null;
    const query = sourceMessage.content;
    const queryTokens = tokenize(query);
    const personalScope: ContextSourceScope = {
      kind: "PERSONAL",
      ownerUserId: input.actorUserId,
    };
    const currentSurfaceScope: ContextSourceScope =
      currentProjectId
        ? {
            kind: "PROJECT",
            projectId: currentProjectId,
          }
        : personalScope;

    const recentMessages = await this.db.message.findMany({
      where: {
        conversationId: sourceMessage.conversation.id,
        id: { not: sourceMessage.id },
        status: "COMPLETE",
        createdAt: { lte: sourceMessage.createdAt },
      },
      select: {
        id: true,
        role: true,
        content: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: this.options.l1RawLimit,
    });

    const recentIds = recentMessages.map((message) => message.id);
    const [
      olderCurrent,
      crossConversation,
      workspace,
      projects,
      artifacts,
      rawHistoryRows,
    ] = await Promise.all([
        this.db.message.findMany({
          where: {
            conversationId: sourceMessage.conversation.id,
            id: {
              notIn: [sourceMessage.id, ...recentIds],
            },
            status: "COMPLETE",
            createdAt: { lte: sourceMessage.createdAt },
          },
          select: {
            id: true,
            role: true,
            content: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: this.options.olderHistoryScanLimit,
        }),
        this.db.message.findMany({
          where: {
            conversationId: {
              not: sourceMessage.conversation.id,
            },
            conversation: {
              userId: input.actorUserId,
            },
            status: "COMPLETE",
            createdAt: { lte: sourceMessage.createdAt },
          },
          select: {
            id: true,
            role: true,
            content: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            conversationId: true,
            conversation: {
              select: {
                title: true,
                projectId: true,
                updatedAt: true,
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: this.options.crossConversationScanLimit,
        }),
        this.db.workspaceObject.findMany({
          where: {
            personalOwnerUserId: input.actorUserId,
            deletedAt: null,
          },
          select: {
            id: true,
            kind: true,
            scopeType: true,
            sourceConversationId: true,
            sourceMessageId: true,
            archivedAt: true,
            createdAt: true,
            updatedAt: true,
            task: {
              select: {
                title: true,
                description: true,
                status: true,
                priority: true,
                dueAt: true,
                completedAt: true,
              },
            },
            reminder: {
              select: {
                title: true,
                description: true,
                scheduledAt: true,
                timezone: true,
                status: true,
              },
            },
            note: {
              select: {
                title: true,
                contentMarkdown: true,
                pinnedAt: true,
              },
            },
            list: {
              select: {
                type: true,
                title: true,
                description: true,
                items: {
                  select: {
                    text: true,
                    position: true,
                    completedAt: true,
                  },
                  orderBy: { position: "asc" },
                  take: 20,
                },
              },
            },
          },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: this.options.workspaceScanLimit,
        }),
        this.db.project.findMany({
          where: {
            OR: [
              { ownerUserId: input.actorUserId },
              {
                members: {
                  some: {
                    userId: input.actorUserId,
                  },
                },
              },
            ],
          },
          select: {
            id: true,
            name: true,
            description: true,
            ownerUserId: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: this.options.projectScanLimit,
        }),
        this.db.artifact.findMany({
          where: {
            OR: [
              {
                creatorInvocation: {
                  plan: {
                    userId: input.actorUserId,
                  },
                },
              },
              {
                accessGrants: {
                  some: {
                    granteeUserId: input.actorUserId,
                    permission: "READ",
                    revokedAt: null,
                  },
                },
              },
            ],
          },
          select: {
            id: true,
            outputName: true,
            type: true,
            classification: true,
            metadata: true,
            createdAt: true,
            versions: {
              select: {
                id: true,
                version: true,
                fingerprint: true,
                createdAt: true,
              },
              orderBy: { version: "desc" },
              take: 1,
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: this.options.artifactScanLimit,
        }),
        this.db.$queryRaw<Array<{ byteCount: bigint }>>(
          Prisma.sql`
            SELECT
              COALESCE(SUM(GREATEST(OCTET_LENGTH("content"), 1)), 0)::bigint AS "byteCount"
            FROM "message"
            WHERE "conversationId" = ${sourceMessage.conversation.id}
              AND "id" <> ${sourceMessage.id}
              AND "status" = 'COMPLETE'
              AND "createdAt" <= ${sourceMessage.createdAt}
          `,
        ),
      ]);

    const rawHistoryTokens = conservativeTokensFromByteCount(
      rawHistoryRows[0]?.byteCount ?? 0n,
    );

    const candidates: ContextCandidate[] = [
      candidate({
        item: {
          sourceType: "USER_MESSAGE",
          sourceId: sourceMessage.id,
          sourceVersion: sourceMessage.updatedAt.toISOString(),
          classification: "PRIVATE",
          contentRef: "vimla://messages/" + sourceMessage.id,
          metadata: {
            role: sourceMessage.role,
            content: sourceMessage.content,
            status: sourceMessage.status,
            createdAt: sourceMessage.createdAt.toISOString(),
          },
        },
        sourceKind: "IMMEDIATE",
        sourceScope: currentSurfaceScope,
        reason: "current user message",
        lexicalScore: 1,
        directReference: true,
        currentSurface: true,
        currentProject: currentProjectId !== null,
        authority: "RAW",
        occurredAt: sourceMessage.createdAt.toISOString(),
      }),
      candidate({
        item: {
          sourceType: "CONVERSATION",
          sourceId: sourceMessage.conversation.id,
          sourceVersion: sourceMessage.conversation.updatedAt.toISOString(),
          classification: "PRIVATE",
          contentRef:
            "vimla://conversations/" + sourceMessage.conversation.id,
          metadata: {
            title: sourceMessage.conversation.title,
            kind: sourceMessage.conversation.kind,
            createdAt:
              sourceMessage.conversation.createdAt.toISOString(),
          },
        },
        sourceKind: "IMMEDIATE",
        sourceScope: currentSurfaceScope,
        reason: "current conversation",
        lexicalScore: lexicalScore(
          queryTokens,
          tokenize(sourceMessage.conversation.title ?? ""),
        ),
        directReference: true,
        currentSurface: true,
        currentProject: currentProjectId !== null,
        authority: "AUTHORITATIVE",
        occurredAt:
          sourceMessage.conversation.updatedAt.toISOString(),
        rawHistoryTokens,
      }),
      candidate({
        item: {
          sourceType: "PARTICIPANT",
          sourceId: plan.user.id,
          sourceVersion: plan.user.updatedAt.toISOString(),
          classification: "PRIVATE",
          contentRef: "vimla://users/" + plan.user.id,
          metadata: {
            name: plan.user.name,
          },
        },
        sourceKind: "IMMEDIATE",
        sourceScope: personalScope,
        reason: "invoking participant",
        lexicalScore: 0,
        directReference: true,
        currentSurface: true,
        currentProject: false,
        authority: "AUTHORITATIVE",
        occurredAt: plan.user.updatedAt.toISOString(),
      }),
      candidate({
        item: {
          sourceType: "LOCALE_TIMEZONE",
          sourceId: plan.user.id,
          sourceVersion: (
            plan.user.preference?.updatedAt ?? plan.user.updatedAt
          ).toISOString(),
          classification: "PRIVATE",
          metadata: {
            locale: plan.user.preference?.locale ?? null,
            timezone: plan.user.preference?.timezone ?? null,
          },
        },
        sourceKind: "IMMEDIATE",
        sourceScope: personalScope,
        reason: "locale and timezone",
        lexicalScore: 0,
        directReference: true,
        currentSurface: true,
        currentProject: false,
        authority: "AUTHORITATIVE",
        occurredAt: (
          plan.user.preference?.updatedAt ?? plan.user.updatedAt
        ).toISOString(),
      }),
      candidate({
        item: {
          sourceType: "AUDIENCE",
          sourceId:
            currentProjectId ??
            sourceMessage.conversation.id,
          sourceVersion:
            currentProject?.updatedAt.toISOString() ??
            sourceMessage.conversation.updatedAt.toISOString(),
          classification: "PRIVATE",
          metadata: currentProjectId
            ? {
                kind: "PROJECT",
                projectId: currentProjectId,
                participantUserIds: [input.actorUserId],
              }
            : {
                kind: "PERSONAL",
                participantUserIds: [input.actorUserId],
              },
        },
        sourceKind: "IMMEDIATE",
        sourceScope: currentSurfaceScope,
        reason: "response audience",
        lexicalScore: 0,
        directReference: true,
        currentSurface: true,
        currentProject: currentProjectId !== null,
        authority: "AUTHORITATIVE",
        occurredAt:
          currentProject?.updatedAt.toISOString() ??
          sourceMessage.conversation.updatedAt.toISOString(),
      }),
      ...recentMessages
        .reverse()
        .map((message) =>
          messageCandidate(
            message,
            currentSurfaceScope,
            "L1_RAW",
            "recent raw current-conversation history",
            queryTokens,
            true,
            undefined,
            currentProjectId !== null,
          ),
        ),
    ];

    candidates.push(
      ...rankRelevantMessages(
        olderCurrent,
        queryTokens,
        this.options.relevantHistoryLimit,
      ).map(({ message, score }) =>
        messageCandidate(
          message,
          currentSurfaceScope,
          "OLDER_HISTORY",
          "lexically relevant older current-conversation message",
          queryTokens,
          true,
          score,
          currentProjectId !== null,
        ),
      ),
    );

    candidates.push(
      ...rankRelevantMessages(
        crossConversation,
        queryTokens,
        this.options.relevantHistoryLimit,
        true,
      ).map(({ message, score }) =>
        candidate({
          item: {
            sourceType: "MESSAGE",
            sourceId: message.id,
            sourceVersion: message.updatedAt.toISOString(),
            classification: "PRIVATE",
            contentRef: "vimla://messages/" + message.id,
            metadata: {
              role: message.role,
              content: message.content,
              status: message.status,
              createdAt: message.createdAt.toISOString(),
              conversationTitle: message.conversation.title,
            },
          },
          sourceKind: "CROSS_CONVERSATION",
          sourceScope:
            currentProjectId !== null &&
            message.conversation.projectId === currentProjectId
              ? {
                  kind: "PROJECT",
                  projectId: currentProjectId,
                }
              : personalScope,
          reason:
            "same-user cross-conversation lexical retrieval",
          lexicalScore: score,
          directReference: false,
          currentSurface: false,
          currentProject:
            currentProjectId !== null &&
            currentProjectId !== undefined &&
            message.conversation.projectId === currentProjectId,
          authority: "RAW",
          occurredAt: message.createdAt.toISOString(),
        }),
      ),
    );

    candidates.push(
      ...rankStructured(
        workspace,
        queryTokens,
        this.options.workspaceLimit,
        (object) => workspaceSearchText(object),
        (object) =>
          object.sourceMessageId === sourceMessage.id ||
          object.sourceConversationId ===
            sourceMessage.conversation.id ||
          queryReferencesId(query, object.id),
      ).map(({ value: object, score, directReference }) =>
        candidate({
          item: {
            sourceType: "WORKSPACE_OBJECT",
            sourceId: object.id,
            sourceVersion: object.updatedAt.toISOString(),
            classification: "PRIVATE",
            contentRef: "vimla://workspace/" + object.id,
            metadata: workspaceMetadata(object),
          },
          sourceKind:
            object.kind === "NOTE"
              ? "FILE_METADATA"
              : "WORKSPACE_OBJECT",
          sourceScope: personalScope,
          reason: directReference
            ? "workspace object linked to current surface"
            : "authorized workspace object lexical retrieval",
          lexicalScore: score,
          directReference,
          currentSurface: directReference,
          currentProject: false,
          authority: "AUTHORITATIVE",
          occurredAt: object.updatedAt.toISOString(),
          stale: object.archivedAt !== null,
        }),
      ),
    );

    candidates.push(
      ...rankStructured(
        projects,
        queryTokens,
        this.options.projectLimit,
        (project) =>
          [project.name, project.description ?? ""].join("\n"),
        (project) => queryReferencesId(query, project.id),
      ).map(({ value: project, score, directReference }) =>
        candidate({
          item: {
            sourceType: "PROJECT",
            sourceId: project.id,
            sourceVersion: project.updatedAt.toISOString(),
            classification: "PRIVATE",
            contentRef: "vimla://projects/" + project.id,
            metadata: {
              name: project.name,
              description: project.description,
              createdAt: project.createdAt.toISOString(),
            },
          },
          sourceKind: "PROJECT_OBJECT",
          sourceScope: {
            kind: "PROJECT",
            projectId: project.id,
          },
          reason: "authorized project lexical retrieval",
          lexicalScore: score,
          directReference,
          currentSurface: false,
          currentProject:
            project.id === currentProjectId,
          authority: "AUTHORITATIVE",
          occurredAt: project.updatedAt.toISOString(),
        }),
      ),
    );

    const rankedArtifacts = rankStructured(
      artifacts.filter((artifact) =>
        isKnownClassification(artifact.classification),
      ),
      queryTokens,
      this.options.artifactLimit,
      (artifact) =>
        [
          artifact.outputName,
          artifact.type,
          JSON.stringify(artifact.metadata ?? null),
        ].join("\n"),
      (artifact) => queryReferencesId(query, artifact.id),
    );
    const selectedArtifactVersionIds = rankedArtifacts.flatMap(
      ({ value: artifact }) => {
        const latest = artifact.versions[0];
        return latest ? [latest.id] : [];
      },
    );
    const artifactContentByVersionId = new Map<
      string,
      Awaited<ReturnType<ArtifactService["readVersion"]>>["content"]
    >();
    for (const artifactVersionId of selectedArtifactVersionIds) {
      try {
        const version = await this.artifacts.readVersion({
          actorUserId: input.actorUserId,
          artifactVersionId,
        });
        artifactContentByVersionId.set(
          artifactVersionId,
          version.content,
        );
      } catch (error: unknown) {
        if (error instanceof ArtifactNotFoundError) {
          throw new ContextAccessDeniedError(
            "Artifact context access changed during retrieval",
          );
        }
        throw error;
      }
    }

    candidates.push(
      ...rankedArtifacts.map(
        ({ value: artifact, score, directReference }) => {
          const latest = artifact.versions[0];
          const latestContent = latest
            ? artifactContentByVersionId.get(latest.id)
            : undefined;
          const inlineContentJson =
            latestContent?.kind === "INLINE_JSON"
              ? JSON.stringify(latestContent.value)
              : null;
          return candidate({
            item: {
              sourceType: "ARTIFACT",
              sourceId: artifact.id,
              sourceVersion: latest
                ? String(latest.version)
                : artifact.createdAt.toISOString(),
              classification: parseClassification(
                artifact.classification,
              ),
              contentRef: latest
                ? "vimla://artifacts/" +
                  artifact.id +
                  "/versions/" +
                  latest.id
                : "vimla://artifacts/" + artifact.id,
              metadata: {
                outputName: artifact.outputName,
                type: artifact.type,
                metadata: artifact.metadata,
                contentKind: inlineContentJson
                  ? "INLINE_JSON"
                  : latestContent?.kind === "CONTENT_REF"
                    ? "CONTENT_REF"
                    : null,
                inlineContentJson,
                latestVersion: latest
                  ? {
                      version: latest.version,
                      fingerprint: latest.fingerprint,
                      createdAt: latest.createdAt.toISOString(),
                    }
                  : null,
              } as Prisma.InputJsonValue,
            },
            sourceKind: "ARTIFACT",
            sourceScope: personalScope,
            reason: inlineContentJson
              ? "authorized immutable artifact content retrieval"
              : "authorized artifact metadata retrieval",
            lexicalScore: score,
            directReference,
            currentSurface: false,
            currentProject: false,
            authority: "AUTHORITATIVE",
            occurredAt: artifact.createdAt.toISOString(),
          });
        },
      ),
    );

    const providerInput: ContextRetrievalProviderInput = {
      actorUserId: input.actorUserId,
      planId: input.planId,
      query,
      conversationId: sourceMessage.conversation.id,
      sourceMessageId: sourceMessage.id,
      sourceMessageCreatedAt:
        sourceMessage.createdAt.toISOString(),
      currentProjectId: currentProjectId ?? null,
    };
    if (this.semanticSearch) {
      const semantic = await this.semanticSearch.retrieve(providerInput);
      candidates.push(...semantic.map(entry => candidate(entry)));
    }
    for (const provider of this.providers) {
      const provided = await provider.retrieve(providerInput);
      for (const entry of provided) {
        candidates.push(normalizeDerivedProviderCandidate(entry));
      }
    }

    const surfaceCandidates = currentProjectId
      ? candidates.filter(
          (candidateValue) =>
            candidateValue.sourceScope.kind === "PROJECT" &&
            candidateValue.sourceScope.projectId ===
              currentProjectId,
        )
      : candidates;

    return {
      query,
      candidates: normalizeCandidates(
        surfaceCandidates,
        this.options.maxCandidates,
      ),
    };
  }
}


const PROVIDER_DERIVED_SOURCE_TYPES = new Set([
  "COMPACTED_STATE",
  "MEMORY",
  "ENTITY",
]);

function normalizeDerivedProviderCandidate(
  candidateValue: ContextCandidate,
): ContextCandidate {
  if (
    !PROVIDER_DERIVED_SOURCE_TYPES.has(
      candidateValue.item.sourceType,
    )
  ) {
    throw new ContextValidationError(
      "Context retrieval providers may only return derived context sources",
    );
  }
  if (candidateValue.authority !== "DERIVED") {
    throw new ContextValidationError(
      "Derived context providers cannot claim source-of-truth authority",
    );
  }
  if (
    !isKnownContextClassification(
      candidateValue.item.classification,
    )
  ) {
    throw new ContextValidationError(
      "Derived context provider classification is invalid",
    );
  }
  if (
    !Number.isFinite(candidateValue.lexicalScore) ||
    candidateValue.lexicalScore < 0 ||
    candidateValue.lexicalScore > 1
  ) {
    throw new ContextValidationError(
      "Derived context provider relevance score is invalid",
    );
  }
  if (
    candidateValue.reason.trim().length === 0 ||
    candidateValue.reason.length > 512
  ) {
    throw new ContextValidationError(
      "Derived context provider selection reason is invalid",
    );
  }
  if (
    candidateValue.occurredAt !== null &&
    !Number.isFinite(Date.parse(candidateValue.occurredAt))
  ) {
    throw new ContextValidationError(
      "Derived context provider timestamp is invalid",
    );
  }
  if (candidateValue.sourceScope.kind === "DIRECT_CHAT") {
    throw new ContextValidationError(
      "Server retrieval providers cannot contribute Direct Chat context",
    );
  }

  const expectedSourceKind =
    candidateValue.item.sourceType === "COMPACTED_STATE"
      ? "L2_COMPACTED"
      : candidateValue.item.sourceType === "ENTITY"
        ? "ENTITY"
        : candidateValue.sourceScope.kind === "PROJECT"
          ? "PROJECT_MEMORY"
          : "PERSONAL_MEMORY";
  if (candidateValue.sourceKind !== expectedSourceKind) {
    throw new ContextValidationError(
      "Derived context provider source kind does not match its source type and scope",
    );
  }

  return candidate({
    ...candidateValue,
    item: {
      ...candidateValue.item,
      metadata: stripProviderRetrievalMetadata(
        candidateValue.item.metadata,
      ),
    },
    semanticScore: undefined,
    hybridScore: undefined,
    estimatedTokens: undefined,
    rawHistoryTokens: undefined,
  });
}

function stripProviderRetrievalMetadata(
  value: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | null | undefined {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return value;
  }
  const { retrieval: _retrieval, ...rest } =
    value as Prisma.InputJsonObject;
  return rest as Prisma.InputJsonValue;
}

function messageCandidate(
  message: {
    id: string;
    role: string;
    content: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  },
  sourceScope: ContextSourceScope,
  sourceKind: ContextRetrievalSourceKind,
  reason: string,
  queryTokens: readonly string[],
  currentSurface: boolean,
  score = lexicalScore(queryTokens, tokenize(message.content)),
  currentProject = false,
): ContextCandidate {
  return candidate({
    item: {
      sourceType: "MESSAGE",
      sourceId: message.id,
      sourceVersion: message.updatedAt.toISOString(),
      classification: "PRIVATE",
      contentRef: "vimla://messages/" + message.id,
      metadata: {
        role: message.role,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt.toISOString(),
      },
    },
    sourceKind,
    sourceScope,
    reason,
    lexicalScore: score,
    directReference: false,
    currentSurface,
    currentProject,
    authority: "RAW",
    occurredAt: message.createdAt.toISOString(),
  });
}

function candidate(
  input: Omit<ContextCandidate, "estimatedTokens"> & {
    estimatedTokens?: number;
  },
): ContextCandidate {
  const estimatedTokens =
    input.estimatedTokens ??
    estimateTokens(
      JSON.stringify(input.item.metadata ?? null),
    );
  return {
    ...input,
    estimatedTokens,
    item: {
      ...input.item,
      metadata: attachRetrievalMetadata(
        input.item.metadata,
        {
          sourceKind: input.sourceKind,
          scope: scopeMetadata(input.sourceScope),
          reason: input.reason,
          lexicalScore: roundScore(input.lexicalScore),
          ...(input.semanticScore !== undefined ? { semanticScore: roundScore(input.semanticScore) } : {}),
          ...(input.hybridScore !== undefined ? { hybridScore: roundScore(input.hybridScore) } : {}),
          directReference: input.directReference,
          currentSurface: input.currentSurface,
          currentProject: input.currentProject,
          authority: input.authority,
          ...(input.occurredAt
            ? { occurredAt: input.occurredAt }
            : {}),
          ...(input.rawHistoryTokens !== undefined
            ? { rawHistoryTokens: input.rawHistoryTokens }
            : {}),
          estimatedTokens,
          stale: input.stale === true,
          superseded: input.superseded === true,
        },
      ),
    },
  };
}

function attachRetrievalMetadata(
  metadata: Prisma.InputJsonValue | null | undefined,
  retrieval: Record<string, Prisma.InputJsonValue>,
): Prisma.InputJsonValue {
  const base =
    metadata !== null &&
    metadata !== undefined &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
      ? (metadata as Prisma.InputJsonObject)
      : {
          value: metadata ?? null,
        };

  return {
    ...base,
    retrieval,
  } as Prisma.InputJsonValue;
}

function scopeMetadata(
  scope: ContextSourceScope,
): Prisma.InputJsonValue {
  switch (scope.kind) {
    case "PERSONAL":
      return {
        kind: "PERSONAL",
        ownerUserId: scope.ownerUserId,
      };
    case "PROJECT":
      return {
        kind: "PROJECT",
        projectId: scope.projectId,
      };
    case "DIRECT_CHAT":
      return {
        kind: "DIRECT_CHAT",
        directConversationId: scope.directConversationId,
      };
  }
}

function rankRelevantMessages<
  T extends {
    content: string;
    createdAt: Date;
    id: string;
  },
>(
  messages: readonly T[],
  queryTokens: readonly string[],
  limit: number,
  requireStrongMatch = false,
): Array<{ message: T; score: number }> {
  return messages
    .map((message) => ({
      message,
      score: lexicalScore(queryTokens, tokenize(message.content)),
      matches: lexicalMatchCount(
        queryTokens,
        tokenize(message.content),
      ),
    }))
    .filter(({ score, matches }) =>
      requireStrongMatch
        ? strongCrossSurfaceMatch(
            score,
            matches,
            queryTokens.length,
          )
        : score > 0,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.message.createdAt.getTime() -
          left.message.createdAt.getTime() ||
        left.message.id.localeCompare(right.message.id),
    )
    .slice(0, limit)
    .map(({ message, score }) => ({ message, score }));
}

function rankStructured<T>(
  values: readonly T[],
  queryTokens: readonly string[],
  limit: number,
  text: (value: T) => string,
  directReference: (value: T) => boolean = () => false,
): Array<{
  value: T;
  score: number;
  directReference: boolean;
}> {
  return values
    .map((value) => {
      const direct = directReference(value);
      const score = lexicalScore(
        queryTokens,
        tokenize(text(value)),
      );
      return {
        value,
        score,
        directReference: direct,
      };
    })
    .filter(
      ({ score, directReference: direct }) =>
        direct || score > 0,
    )
    .sort(
      (left, right) =>
        Number(right.directReference) -
          Number(left.directReference) ||
        right.score - left.score,
    )
    .slice(0, limit);
}

function workspaceSearchText(object: {
  kind: string;
  task: {
    title: string;
    description: string | null;
    status: string;
    priority: string | null;
    dueAt: Date | null;
    completedAt: Date | null;
  } | null;
  reminder: {
    title: string;
    description: string | null;
    scheduledAt: Date;
    timezone: string;
    status: string;
  } | null;
  note: {
    title: string;
    contentMarkdown: string;
    pinnedAt: Date | null;
  } | null;
  list: {
    type: string;
    title: string;
    description: string | null;
    items: Array<{
      text: string;
      position: number;
      completedAt: Date | null;
    }>;
  } | null;
}): string {
  return [
    object.kind,
    object.task?.title ?? "",
    object.task?.description ?? "",
    object.reminder?.title ?? "",
    object.reminder?.description ?? "",
    object.note?.title ?? "",
    object.note?.contentMarkdown ?? "",
    object.list?.title ?? "",
    object.list?.description ?? "",
    ...(object.list?.items.map((item) => item.text) ?? []),
  ].join("\n");
}

function workspaceMetadata(object: {
  kind: string;
  scopeType: string;
  archivedAt: Date | null;
  createdAt: Date;
  task: {
    title: string;
    description: string | null;
    status: string;
    priority: string | null;
    dueAt: Date | null;
    completedAt: Date | null;
  } | null;
  reminder: {
    title: string;
    description: string | null;
    scheduledAt: Date;
    timezone: string;
    status: string;
  } | null;
  note: {
    title: string;
    contentMarkdown: string;
    pinnedAt: Date | null;
  } | null;
  list: {
    type: string;
    title: string;
    description: string | null;
    items: Array<{
      text: string;
      position: number;
      completedAt: Date | null;
    }>;
  } | null;
}): Prisma.InputJsonValue {
  return {
    kind: object.kind,
    scopeType: object.scopeType,
    archivedAt: object.archivedAt?.toISOString() ?? null,
    createdAt: object.createdAt.toISOString(),
    task: object.task
      ? {
          ...object.task,
          dueAt: object.task.dueAt?.toISOString() ?? null,
          completedAt:
            object.task.completedAt?.toISOString() ?? null,
        }
      : null,
    reminder: object.reminder
      ? {
          ...object.reminder,
          scheduledAt:
            object.reminder.scheduledAt.toISOString(),
        }
      : null,
    note: object.note
      ? {
          ...object.note,
          pinnedAt: object.note.pinnedAt?.toISOString() ?? null,
        }
      : null,
    list: object.list
      ? {
          type: object.list.type,
          title: object.list.title,
          description: object.list.description,
          items: object.list.items.map((item) => ({
            text: item.text,
            position: item.position,
            completedAt:
              item.completedAt?.toISOString() ?? null,
          })),
        }
      : null,
  };
}

function normalizeCandidates(
  candidates: readonly ContextCandidate[],
  maxCandidates: number,
): ContextCandidate[] {
  const bySource = new Map<string, ContextCandidate>();
  for (const entry of candidates) {
    const key =
      entry.item.sourceType + ":" + entry.item.sourceId;
    const current = bySource.get(key);
    if (!current || preferCandidate(entry, current)) {
      bySource.set(key, entry);
    }
  }

  const normalized = [...bySource.values()].sort(compareCandidatePriority);
  if (normalized.length <= maxCandidates) return normalized;

  const required = normalized.filter((entry) =>
    isRequiredCandidate(entry),
  );
  const optional = normalized.filter(
    (entry) => !isRequiredCandidate(entry),
  );
  return [
    ...required,
    ...optional.slice(
      0,
      Math.max(0, maxCandidates - required.length),
    ),
  ].slice(0, maxCandidates);
}

function preferCandidate(
  candidateValue: ContextCandidate,
  current: ContextCandidate,
): boolean {
  // Semantic rediscovery must not demote the authoritative recent raw tail.
  if (current.sourceKind === "L1_RAW") return false;
  if (candidateValue.sourceKind === "L1_RAW") return true;
  return (
    compareCandidatePriority(candidateValue, current) < 0
  );
}

function compareCandidatePriority(
  left: ContextCandidate,
  right: ContextCandidate,
): number {
  return (
    Number(isRequiredCandidate(right)) -
      Number(isRequiredCandidate(left)) ||
    Number(right.currentSurface) -
      Number(left.currentSurface) ||
    Number(right.directReference) -
      Number(left.directReference) ||
    Number(right.currentProject) -
      Number(left.currentProject) ||
    authorityRank(right.authority) -
      authorityRank(left.authority) ||
    (right.hybridScore ?? right.lexicalScore) - (left.hybridScore ?? left.lexicalScore) ||
    compareDateDesc(left.occurredAt, right.occurredAt) ||
    left.item.sourceType.localeCompare(right.item.sourceType) ||
    left.item.sourceId.localeCompare(right.item.sourceId)
  );
}

function isRequiredCandidate(
  value: ContextCandidate,
): boolean {
  return (
    value.item.sourceType === "USER_MESSAGE" ||
    value.item.sourceType === "CONVERSATION" ||
    value.item.sourceType === "PARTICIPANT" ||
    value.item.sourceType === "LOCALE_TIMEZONE" ||
    value.item.sourceType === "AUDIENCE"
  );
}

function authorityRank(authority: ContextSourceAuthority): number {
  switch (authority) {
    case "AUTHORITATIVE":
      return 3;
    case "RAW":
      return 2;
    case "DERIVED":
      return 1;
  }
}

function tokenize(value: string): string[] {
  const matches =
    value
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return [
    ...new Set(
      matches.filter(
        (token) =>
          token.length >= 2 && !STOP_WORDS.has(token),
      ),
    ),
  ];
}

function lexicalScore(
  queryTokens: readonly string[],
  candidateTokens: readonly string[],
): number {
  if (
    queryTokens.length === 0 ||
    candidateTokens.length === 0
  ) {
    return 0;
  }
  const candidateSet = new Set(candidateTokens);
  let matches = 0;
  for (const token of queryTokens) {
    if (candidateSet.has(token)) matches += 1;
  }
  if (matches === 0) return 0;

  const queryCoverage = matches / queryTokens.length;
  const candidateCoverage =
    matches / Math.max(1, candidateSet.size);
  return roundScore(
    queryCoverage * 0.75 + candidateCoverage * 0.25,
  );
}

function lexicalMatchCount(
  queryTokens: readonly string[],
  candidateTokens: readonly string[],
): number {
  const candidateSet = new Set(candidateTokens);
  return queryTokens.reduce(
    (count, token) =>
      count + Number(candidateSet.has(token)),
    0,
  );
}

function strongCrossSurfaceMatch(
  score: number,
  matches: number,
  queryTokenCount: number,
): boolean {
  if (score <= 0) return false;
  if (queryTokenCount <= 2) {
    return matches >= 1 && score >= 0.2;
  }
  return matches >= 2 && score >= 0.18;
}

function queryReferencesId(
  query: string,
  id: string,
): boolean {
  return id.length > 0 && query.includes(id);
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function compareDateDesc(
  left: string | null,
  right: string | null,
): number {
  const a = left ? Date.parse(left) : Number.NaN;
  const b = right ? Date.parse(right) : Number.NaN;
  if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
  if (!Number.isFinite(a)) return 1;
  if (!Number.isFinite(b)) return -1;
  return b - a;
}

function isKnownClassification(
  value: string,
): value is ContextClassification {
  return (
    value === "PUBLIC" ||
    value === "INTERNAL" ||
    value === "PRIVATE" ||
    value === "RESTRICTED"
  );
}

function parseClassification(
  value: string,
): ContextClassification {
  if (!isKnownClassification(value)) {
    throw new ContextConflictError(
      "Artifact context classification is invalid",
    );
  }
  return value;
}
