import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { PeopleModule } from "../people/people.module.js";
import { InboxController } from "./inbox.controller.js";
import { InboxService } from "./inbox.service.js";

@Module({
  imports: [PersistenceModule, AuthModule, PeopleModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
