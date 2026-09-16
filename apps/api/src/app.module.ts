import { type DynamicModule, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import type { ApiConfig } from "@vimla/config";
import { isDevBillingEnvironment } from "@vimla/billing";
import { isDevNotificationInboxEnabled } from "@vimla/notifications";
import { API_CONFIG, type ApiRuntimeConfig } from "./config/api-config.js";
import { ApiConfigModule } from "./config/api-config.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { DevNotificationsModule } from "./auth/dev-notifications.module.js";
import { BillingModule } from "./billing/billing.module.js";
import { DevBillingModule } from "./billing/dev-billing.module.js";
import { AiModule } from "./ai/ai.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { HealthModule } from "./health/health.module.js";
import { WorkspaceModule } from "./workspace/workspace.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { OperatorModule } from "./operator/operator.module.js";
import { OrchestrationModule } from "./orchestration/orchestration.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { DirectChatsModule } from "./direct-chats/direct-chats.module.js";
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
      AdminModule,
      WorkspaceModule,
      NotificationsModule,
      OperatorModule,
      OrchestrationModule,
      ProjectsModule,
      DirectChatsModule,
    ];

    if (isDevBillingEnvironment(config.appEnv)) {
      imports.push(DevBillingModule);
    }

    if (isDevNotificationInboxEnabled(config.appEnv)) {
      imports.push(DevNotificationsModule);
    }

    return {
      module: AppModule,
      imports,
    };
  }
}
