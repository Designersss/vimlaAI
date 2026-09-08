import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  createVimlaAuthFromConfig,
  type VimlaAuth,
} from "@vimla/auth";
import {
  createNotificationService,
  redisNotificationStore,
  type EmailAdapterConfig,
  type NotificationService,
  type SmsAdapterConfig,
} from "@vimla/notifications";
import { API_CONFIG, type ApiRuntimeConfig } from "../config/api-config.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { RedisService } from "../persistence/redis.service.js";

@Injectable()
export class AuthService {
  readonly auth: VimlaAuth;
  readonly notifications: NotificationService;
  private readonly logger = new Logger("Notifications");

  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(RedisService) redis: RedisService,
    @Inject(API_CONFIG) config: ApiRuntimeConfig,
  ) {
    this.notifications = createNotificationService({
      appEnv: config.appEnv,
      secret: config.betterAuthSecret,
      defaultLocale: config.authDefaultLocale,
      email: emailAdapterFromConfig(config),
      sms: smsAdapterFromConfig(config),
      store: redisNotificationStore(redis.client),
      limits: {
        emailRetryMax: config.notifyEmailRetryMax,
        smsRetryMax: config.notifySmsRetryMax,
        emailPerDestPerHour: config.notifyEmailPerDestPerHour,
        emailPerIpPerHour: config.notifyEmailPerIpPerHour,
        emailGlobalPerMinute: config.notifyEmailGlobalPerMinute,
        smsPerPhonePerHour: config.notifySmsPerPhonePerHour,
        smsPerAccountPerHour: config.notifySmsPerAccountPerHour,
        smsPerIpPerHour: config.notifySmsPerIpPerHour,
        smsGlobalPerMinute: config.notifySmsGlobalPerMinute,
      },
      onEvent: (event) => {
        this.logger.log({
          msg: "notification_delivery",
          channel: event.channel,
          templateId: event.templateId,
          provider: event.provider,
          success: event.success,
          latencyMs: event.latencyMs,
          errorCategory: event.errorCategory,
          retryCount: event.retryCount,
          destinationHash: event.destinationHash,
        });
      },
    });
    this.auth = createVimlaAuthFromConfig(
      prisma.client,
      config,
      redis.client,
      this.notifications,
    );
  }
}

function emailAdapterFromConfig(config: ApiRuntimeConfig): EmailAdapterConfig {
  if (config.emailProvider !== "smtp") {
    return { kind: "memory" };
  }
  if (!config.smtpHost || !config.smtpUser || !config.smtpPassword || !config.emailFrom) {
    throw new Error("SMTP notification configuration is incomplete");
  }
  return {
    kind: "smtp",
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    user: config.smtpUser,
    password: config.smtpPassword,
    from: config.emailFrom,
    replyTo: config.emailReplyTo,
  };
}

function smsAdapterFromConfig(config: ApiRuntimeConfig): SmsAdapterConfig {
  if (config.smsProvider !== "http") {
    return { kind: "memory" };
  }
  if (!config.smsHttpUrl || !config.smsHttpAuthorization) {
    throw new Error("HTTP SMS notification configuration is incomplete");
  }
  return {
    kind: "http",
    url: config.smsHttpUrl,
    authorization: config.smsHttpAuthorization,
  };
}
