import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { PeopleModule } from "../people/people.module.js";
import { MentionsController } from "./mentions.controller.js";
import { MentionsService } from "./mentions.service.js";

@Module({
  imports: [PersistenceModule, AuthModule, AiModule, PeopleModule],
  controllers: [MentionsController],
  providers: [MentionsService],
})
export class MentionsModule {}
