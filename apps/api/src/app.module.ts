import { type DynamicModule, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import type { ApiConfig } from "@vimla/config";
import { isDevBillingEnvironment } from "@vimla/billing";
import { API_CONFIG, type ApiRuntimeConfig } from "./config/api-config.js";
import { ApiConfigModule } from "./config/api-config.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { BillingModule } from "./billing/billing.module.js";
import { DevBillingModule } from "./billing/dev-billing.module.js";
import { AiModule } from "./ai/ai.module.js";
import { HealthModule } from "./health/health.module.js";
import { createPinoHttpOptions } from "./observability/logger.js";

@Module({})
export class AppModule {
  static forRoot(config: ApiConfig): DynamicModule {
    const apiConfigModule = ApiConfigModule.forRoot(config);
    const imports = [
      apiConfigModule,
      LoggerModule.forRootAsync({
        imports: [apiConfigModule],
        inject: [API_CONFIG],
        useFactory: (runtime: ApiRuntimeConfig) => ({
          pinoHttp: createPinoHttpOptions(runtime.logLevel),
        }),
      }),
      AuthModule,
      BillingModule,
      AiModule,
      HealthModule,
    ];

    if (isDevBillingEnvironment(config.appEnv)) {
      imports.push(DevBillingModule);
    }

    return {
      module: AppModule,
      imports,
    };
  }
}
