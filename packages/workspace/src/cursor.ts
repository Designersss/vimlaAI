import { WorkspaceError } from "./errors.js";

export interface WorkspaceCursor {
  id: string;
  t: string;
}

export function encodeCursor(cursor: WorkspaceCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): WorkspaceCursor | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      "t" in parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.t === "string"
    ) {
      return { id: parsed.id, t: parsed.t };
    }
  } catch {
    throw new WorkspaceError("VALIDATION_ERROR", "Invalid cursor");
  }
  throw new WorkspaceError("VALIDATION_ERROR", "Invalid cursor");
}
