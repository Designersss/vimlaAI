import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { WorkspaceListsController } from "./lists.controller.js";
import { WorkspaceNotesController } from "./notes.controller.js";
import { WorkspaceRemindersController } from "./reminders.controller.js";
import { WorkspaceTasksController } from "./tasks.controller.js";
import { WorkspaceTodayController } from "./today.controller.js";
import { WorkspaceFacade } from "./workspace.facade.js";
import { WorkspaceRateLimitGuard } from "./workspace-rate-limit.guard.js";

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [
    WorkspaceTodayController,
    WorkspaceTasksController,
    WorkspaceRemindersController,
    WorkspaceListsController,
    WorkspaceNotesController,
  ],
  providers: [WorkspaceFacade, WorkspaceRateLimitGuard],
  exports: [WorkspaceFacade],
})
export class WorkspaceModule {}
