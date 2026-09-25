import { safeTelemetryFields, type TelemetryEvent, type TelemetrySink } from "@vimla/shared";
import type { RuntimeLogger } from "./orchestration.js";

type RuntimeLogValue = string | number | boolean | null;

export function createWorkerTelemetrySink(
  logger: RuntimeLogger,
): TelemetrySink {
  return {
    emit: (event: TelemetryEvent): void => {
      logger.info(toTelemetryLogFields(event), "telemetry");
    },
  };
}

export function toTelemetryLogFields(
  event: TelemetryEvent,
): Record<string, RuntimeLogValue> {
  const fields: Record<string, RuntimeLogValue> = {};

  for (const [key, value] of Object.entries(
    safeTelemetryFields(event),
  )) {
    if (value === undefined) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      fields[key] = value;
      continue;
    }

    fields[key] = JSON.stringify(value);
  }

  return fields;
}
