export interface NotificationMetricsSnapshot {
  emailSent: number;
  emailFailed: number;
  smsSent: number;
  smsFailed: number;
  otpResend: number;
  passwordResetRequests: number;
}

export class NotificationMetrics {
  private emailSent = 0;
  private emailFailed = 0;
  private smsSent = 0;
  private smsFailed = 0;
  private otpResend = 0;
  private passwordResetRequests = 0;

  recordDelivery(channel: "email" | "sms", success: boolean): void {
    if (channel === "email") {
      if (success) {
        this.emailSent += 1;
      } else {
        this.emailFailed += 1;
      }
      return;
    }
    if (success) {
      this.smsSent += 1;
    } else {
      this.smsFailed += 1;
    }
  }

  recordOtpResend(): void {
    this.otpResend += 1;
  }

  recordPasswordResetRequest(): void {
    this.passwordResetRequests += 1;
  }

  snapshot(): NotificationMetricsSnapshot {
    return {
      emailSent: this.emailSent,
      emailFailed: this.emailFailed,
      smsSent: this.smsSent,
      smsFailed: this.smsFailed,
      otpResend: this.otpResend,
      passwordResetRequests: this.passwordResetRequests,
    };
  }
}
