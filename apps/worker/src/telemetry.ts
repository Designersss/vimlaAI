import type { TelemetryEvent, TelemetrySink } from "@vimla/shared";
import type { RuntimeLogger } from "./orchestration.js";

export function createWorkerTelemetrySink(
  logger: RuntimeLogger,
): TelemetrySink {
  return {
    emit: (event: TelemetryEvent): void => {
      logger.info(event, "telemetry");
    },
  };
}
