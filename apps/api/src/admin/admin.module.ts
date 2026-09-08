import { Module } from "@nestjs/common";
import {
  AdminControlService,
} from "@vimla/admin";
import { FinanceQueryService, PolicyAdminService, TariffAdminService } from "@vimla/billing";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { AdminAuthController } from "./admin-auth.controller.js";
import { AdminExplorerController } from "./admin-explorer.controller.js";
import { AdminFinanceController } from "./admin-finance.controller.js";
import { AdminOriginGuard, AdminGuard } from "./admin.guard.js";
import { AdminPermissionGuard } from "./admin-permission.guard.js";
import { AdminRateLimitGuard } from "./admin-rate-limit.guard.js";
import { AdminFacade } from "./admin.service.js";
import { AdminTariffsController } from "./admin-tariffs.controller.js";
import { ADMIN_CONTROL, ADMIN_FINANCE, ADMIN_POLICY, ADMIN_TARIFF } from "./admin.tokens.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [
    AdminAuthController,
    AdminFinanceController,
    AdminTariffsController,
    AdminExplorerController,
  ],
  providers: [
    AdminOriginGuard,
    AdminGuard,
    AdminPermissionGuard,
    AdminRateLimitGuard,
    AdminFacade,
    {
      provide: ADMIN_CONTROL,
      inject: [PrismaService, API_CONFIG],
      useFactory: (prisma: PrismaService, config: ApiRuntimeConfig) =>
        new AdminControlService(prisma.client, {
          secret: config.betterAuthSecret,
          ttlSeconds: config.adminSessionTtlSeconds,
          idleSeconds: config.adminSessionIdleSeconds,
          stepUpSeconds: config.adminStepUpSeconds,
          requireTotp: config.adminRequireTotp,
          requirePasskey: config.adminRequirePasskey,
          cookieSecure: config.nodeEnv === "production" || config.appEnv === "production",
        }),
    },
    {
      provide: ADMIN_TARIFF,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new TariffAdminService(prisma.client),
    },
    {
      provide: ADMIN_POLICY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PolicyAdminService(prisma.client),
    },
    {
      provide: ADMIN_FINANCE,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new FinanceQueryService(prisma.client),
    },
  ],
})
export class AdminModule {}
