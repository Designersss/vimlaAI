import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Query,
} from "@nestjs/common";
import { isDevNotificationInboxEnabled, memoryNotificationInbox } from "@vimla/notifications";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";

@Controller("dev/notifications")
export class DevNotificationsController {
  private readonly logger = new Logger(DevNotificationsController.name);

  constructor(@Inject(API_CONFIG) private readonly config: ApiRuntimeConfig) {
    if (!isDevNotificationInboxEnabled(config.appEnv)) {
      throw new Error("Dev notification inbox is not available");
    }
    this.logger.log("GET /dev/notifications/latest registered");
  }

  @Get("latest")
  latest(
    @Query("channel") channel: string | undefined,
    @Query("to") to: string | undefined,
  ): {
    otp: string | null;
    resetUrl: string | null;
    templateId: string | null;
    channel: "email" | null;
  } {
    if (!isDevNotificationInboxEnabled(this.config.appEnv)) {
      throw new HttpException(
        { code: "not_found", message: "Not Found" },
        HttpStatus.NOT_FOUND,
      );
    }

    if (channel !== undefined && channel !== "email") {
      throw new BadRequestException({
        code: "validation_error",
        message: "channel must be email",
      });
    }

    const delivery = memoryNotificationInbox.latestMatching({
      channel: channel === "email" ? "email" : undefined,
      to: to && to.length > 0 ? to : undefined,
    });

    if (!delivery) {
      throw new HttpException(
        {
          code: "notification_not_found",
          message: "No notification in the local inbox",
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      otp: delivery.otp ?? null,
      resetUrl: delivery.resetUrl ?? null,
      templateId: delivery.templateId,
      channel: delivery.channel,
    };
  }
}
