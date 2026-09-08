import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { VIMLA_AUTH } from "./auth.tokens.js";
import { MeController } from "./me.controller.js";
import { SensitiveAreaGuard } from "./sensitive-area.guard.js";
import { VerifiedEmailGuard } from "./verified-email.guard.js";

@Module({
  imports: [PersistenceModule],
  controllers: [MeController],
  providers: [
    AuthService,
    AuthGuard,
    VerifiedEmailGuard,
    SensitiveAreaGuard,
    {
      provide: VIMLA_AUTH,
      inject: [AuthService],
      useFactory: (authService: AuthService) => authService.auth,
    },
  ],
  exports: [VIMLA_AUTH, AuthGuard, AuthService, VerifiedEmailGuard, SensitiveAreaGuard],
})
export class AuthModule {}
