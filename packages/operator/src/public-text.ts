const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const CUID_RE = /\b[cC][a-zA-Z0-9]{20,}\b/g;

export function sanitizePublicText(value: string, maxLength: number): string {
  const stripped = value.replace(UUID_RE, "").replace(CUID_RE, "").replace(/\s+/g, " ").trim();
  if (stripped.length <= maxLength) {
    return stripped;
  }
  return stripped.slice(0, maxLength).trim();
}

export function looksLikeInternalId(value: string): boolean {
  UUID_RE.lastIndex = 0;
  CUID_RE.lastIndex = 0;
  return UUID_RE.test(value) || CUID_RE.test(value);
}
