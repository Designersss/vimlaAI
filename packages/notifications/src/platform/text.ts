const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function sanitizeUserText(value: string, maxLength: number): string {
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
