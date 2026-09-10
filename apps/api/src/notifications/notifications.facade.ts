import { Inject, Injectable } from "@nestjs/common";
import {
  NotificationInboxService,
  NotificationPreferenceService,
} from "@vimla/notifications";
import { PrismaService } from "../persistence/prisma.service.js";

@Injectable()
export class NotificationsFacade {
  readonly inbox: NotificationInboxService;
  readonly preferences: NotificationPreferenceService;

  constructor(@Inject(PrismaService) prisma: PrismaService) {
    this.inbox = new NotificationInboxService(prisma.client);
    this.preferences = new NotificationPreferenceService(prisma.client);
  }
}
