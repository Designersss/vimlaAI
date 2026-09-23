import { describe, expect, it } from "vitest";
import {
  renderContextBundleItems,
  type ContextSnapshotItemView,
} from "./index.js";

describe("renderContextBundleItems", () => {
  it("strips internal ids, fingerprints and retrieval metadata recursively", () => {
    const rendered = renderContextBundleItems([
      contextItem({
        outputName: "release-note",
        metadata: {
          projectId: "project-secret-id",
          nested: {
            artifactVersionId: "artifact-version-secret-id",
            fingerprint: "sha256:low-entropy-oracle",
            publicText: "keep this content",
          },
        },
        latestVersion: {
          version: 3,
          fingerprint: "sha256:another-oracle",
        },
        retrieval: {
          sourceKind: "ARTIFACT",
          reason: "internal ranking reason",
          lexicalScore: 0.91,
        },
      }),
    ]);

    expect(rendered).toContain("keep this content");
    expect(rendered).toContain('"version":3');
    expect(rendered).not.toContain("project-secret-id");
    expect(rendered).not.toContain("artifact-version-secret-id");
    expect(rendered).not.toContain("low-entropy-oracle");
    expect(rendered).not.toContain("another-oracle");
    expect(rendered).not.toContain("internal ranking reason");
    expect(rendered).not.toContain("lexicalScore");
  });
});

function contextItem(metadata: unknown): ContextSnapshotItemView {
  return {
    id: "snapshot-item-1",
    sequence: 0,
    sourceType: "ARTIFACT",
    sourceId: "artifact-1",
    sourceVersion: "3",
    classification: "PRIVATE",
    contentRef: "vimla://artifacts/artifact-1",
    metadata: metadata as ContextSnapshotItemView["metadata"],
    fingerprint: "sha256:snapshot-item-fingerprint",
    createdAt: "2026-09-23T00:00:00.000Z",
  };
}
