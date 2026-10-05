import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import {
  DefaultPeopleAccessPolicy,
  PEOPLE_ACCESS_POLICY,
} from "./people-access-policy.js";
import { PeopleController } from "./people.controller.js";
import { PeopleRateLimitGuard } from "./people-rate-limit.guard.js";
import { PeopleService } from "./people.service.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [PeopleController],
  providers: [
    PeopleService,
    PeopleRateLimitGuard,
    DefaultPeopleAccessPolicy,
    {
      provide: PEOPLE_ACCESS_POLICY,
      useExisting: DefaultPeopleAccessPolicy,
    },
  ],
  exports: [PeopleService, PEOPLE_ACCESS_POLICY],
})
export class PeopleModule {}
