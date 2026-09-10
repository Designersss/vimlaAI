import type { NotificationDelivery, NotificationInbox } from "./types.js";

export class MemoryNotificationInbox implements NotificationInbox {
  private readonly deliveries: NotificationDelivery[] = [];

  record(delivery: NotificationDelivery): void {
    this.deliveries.push(delivery);
  }

  latest(channel: "email", to: string): NotificationDelivery | null {
    for (let index = this.deliveries.length - 1; index >= 0; index -= 1) {
      const delivery = this.deliveries[index];
      if (delivery && delivery.channel === channel && delivery.to === to) {
        return delivery;
      }
    }

    return null;
  }

  latestMatching(filter: {
    channel?: "email";
    to?: string;
  } = {}): NotificationDelivery | null {
    for (let index = this.deliveries.length - 1; index >= 0; index -= 1) {
      const delivery = this.deliveries[index];
      if (!delivery) {
        continue;
      }
      if (filter.channel && delivery.channel !== filter.channel) {
        continue;
      }
      if (filter.to && delivery.to !== filter.to) {
        continue;
      }
      return delivery;
    }

    return null;
  }

  latestOtp(channel: "email", to: string): string | null {
    return this.latest(channel, to)?.otp ?? null;
  }

  all(): readonly NotificationDelivery[] {
    return this.deliveries;
  }

  clear(): void {
    this.deliveries.length = 0;
  }
}

export const memoryNotificationInbox = new MemoryNotificationInbox();
