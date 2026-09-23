import {
  containsSensitiveContextData,
  type ContextSnapshotView,
} from "@vimla/context";
import type { SemanticPlannerContextItem } from "@vimla/orchestration";

const SAFE_METADATA_KEYS: Record<string, readonly string[]> = {
  MESSAGE: ["role", "content", "status", "createdAt"],
  CONVERSATION: ["title", "kind", "createdAt"],
  PARTICIPANT: ["name"],
  LOCALE_TIMEZONE: ["locale", "timezone"],
  WORKSPACE_OBJECT: [
    "kind",
    "scopeType",
    "archivedAt",
    "deletedAt",
    "createdAt",
  ],
  PROJECT: ["name"],
  ATTACHMENT: ["name", "filename", "mimeType", "contentType", "sizeBytes"],
};

export function semanticPlanningContext(
  snapshot: ContextSnapshotView,
): SemanticPlannerContextItem[] {
  return snapshot.items.flatMap((item) => {
    // The source user message is supplied separately as userText. Repeating it
    // here wastes context and creates a second instruction-shaped copy.
    if (
      item.sourceType === "USER_MESSAGE" ||
      item.classification === "RESTRICTED" ||
      containsSensitiveContextData(item.metadata)
    ) {
      return [];
    }

    const metadata = sanitizeMetadata(item.sourceType, item.metadata);
    return [
      {
        sourceType: item.sourceType,
        classification: item.classification,
        metadata,
      },
    ];
  });
}

function sanitizeMetadata(sourceType: string, value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return null;

  if (sourceType === "AUDIENCE") {
    return {
      ...(typeof record.kind === "string" ? { kind: record.kind } : {}),
      ...(Array.isArray(record.participantUserIds)
        ? { participantCount: record.participantUserIds.length }
        : {}),
    };
  }

  const keys = SAFE_METADATA_KEYS[sourceType] ?? [];
  const sanitized: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in record) sanitized[key] = record[key];
  }
  return sanitized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
