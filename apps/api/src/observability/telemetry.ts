import { Injectable, Logger } from "@nestjs/common";
import type { TelemetryEvent, TelemetrySink } from "@vimla/shared";

@Injectable()
export class ApiTelemetrySink implements TelemetrySink {
  private readonly logger = new Logger("Telemetry");

  emit(event: TelemetryEvent): void {
    this.logger.log({
      msg: "telemetry",
      ...event,
    });
  }
}
