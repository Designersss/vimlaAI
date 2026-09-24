export {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  createCorrelationId,
  readCorrelationId,
} from "./correlation-id.js";
export { hmacSha256Hex, hmacTimingSafeEqualHex } from "./hmac.js";
export {
  DEFAULT_VIMLA_LOCALE,
  LOCALE_COOKIE_NAME,
  VIMLA_LOCALES,
  isVimlaLocale,
  localeFromAcceptLanguage,
  parseVimlaLocale,
  type VimlaLocale,
} from "./locale.js";
export { maskEmail } from "./email.js";

export {
  NOOP_TELEMETRY_SINK,
  countTelemetryValues,
  telemetryDurationMs,
  telemetryRatioBps,
  type TelemetryContextSelectionReason,
  type TelemetryContextSource,
  type TelemetryEvent,
  type TelemetryOutcome,
  type TelemetryPolicyDenialReason,
  type TelemetrySink,
  type TelemetryTargetKind,
} from "./telemetry.js";
