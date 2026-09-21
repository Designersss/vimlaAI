import { describe, expect, it } from "vitest";
import type { ContextSnapshotView } from "@vimla/context";
import { semanticPlanningContext } from "./planning-context.js";

describe("semanticPlanningContext", () => {
  it("removes authoritative ids and refs while preserving semantic evidence", () => {
    const snapshot = {
      id: "snapshot-secret",
      planId: "plan-secret",
      version: 1,
      fingerprint: "fingerprint",
      createdAt: new Date().toISOString(),
      items: [
        item("USER_MESSAGE", "message-secret", {
          role: "USER",
          content: "current request",
        }),
        item("MESSAGE", "history-secret", {
          role: "ASSISTANT",
          content: "prior context",
          status: "COMPLETE",
          createdAt: "2026-09-21T10:00:00.000Z",
          userId: "must-not-leak",
        }),
        item("PARTICIPANT", "user-secret", {
          name: "Alice",
          email: "private@example.test",
        }),
        item("AUDIENCE", "conversation-secret", {
          kind: "PERSONAL",
          participantUserIds: ["user-secret"],
        }),
        {
          ...item("MESSAGE", "restricted-secret", {
            role: "USER",
            content: "must never reach planner",
          }),
          classification: "RESTRICTED",
        },
      ],
    } satisfies ContextSnapshotView;

    const projected = semanticPlanningContext(snapshot);
    expect(projected).toEqual([
      {
        sourceType: "MESSAGE",
        classification: "PRIVATE",
        metadata: {
          role: "ASSISTANT",
          content: "prior context",
          status: "COMPLETE",
          createdAt: "2026-09-21T10:00:00.000Z",
        },
      },
      {
        sourceType: "PARTICIPANT",
        classification: "PRIVATE",
        metadata: { name: "Alice" },
      },
      {
        sourceType: "AUDIENCE",
        classification: "PRIVATE",
        metadata: { kind: "PERSONAL", participantCount: 1 },
      },
    ]);

    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("private@example.test");
    expect(serialized).not.toContain("vimla://");
    expect(serialized).not.toContain("current request");
    expect(serialized).not.toContain("must never reach planner");
  });
});

function item(
  sourceType: ContextSnapshotView["items"][number]["sourceType"],
  sourceId: string,
  metadata: Record<string, unknown>,
): ContextSnapshotView["items"][number] {
  return {
    id: `item-${sourceId}`,
    sequence: 0,
    sourceType,
    sourceId,
    sourceVersion: "v1",
    classification: "PRIVATE",
    contentRef: `vimla://private/${sourceId}`,
    metadata,
    fingerprint: "fingerprint",
    createdAt: new Date().toISOString(),
  };
}
