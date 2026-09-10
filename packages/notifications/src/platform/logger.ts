export interface PlatformLogger {
  info(fields: Record<string, string | number | boolean | null>, message: string): void;
  warn(fields: Record<string, string | number | boolean | null>, message: string): void;
  error(fields: Record<string, string | number | boolean | null>, message: string): void;
}

export const silentPlatformLogger: PlatformLogger = {
  info() {},
  warn() {},
  error() {},
};
