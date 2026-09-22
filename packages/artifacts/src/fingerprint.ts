import { createHash } from "node:crypto";
import type { Prisma } from "@vimla/database";
import type { ArtifactContent, ResolvedArtifactInput } from "./types.js";

export function fingerprintArtifactContent(content: ArtifactContent): string {
  const payload =
    content.kind === "CONTENT_REF"
      ? `ref:${content.ref}`
      : `json:${canonicalJson(content.value)}`;
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

export function fingerprintResolvedArtifactInputs(
  inputs: readonly Pick<ResolvedArtifactInput, "inputName" | "reference">[],
): string {
  const canonical = [...inputs]
    .sort((left, right) => left.inputName.localeCompare(right.inputName))
    .map((input) => ({
      inputName: input.inputName,
      artifactVersionId: input.reference.artifactVersionId,
      fingerprint: input.reference.fingerprint,
    }));
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex")}`;
}

export function canonicalJson(value: Prisma.InputJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Artifact JSON content cannot contain non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}
