import { Global, Module } from "@nestjs/common";
import { ApiTelemetrySink } from "./telemetry.js";

@Global()
@Module({
  providers: [ApiTelemetrySink],
  exports: [ApiTelemetrySink],
})
export class ObservabilityModule {}
