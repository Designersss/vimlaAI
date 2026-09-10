export interface NotificationMetricsSnapshot {
  emailSent: number;
  emailFailed: number;
  otpResend: number;
  passwordResetRequests: number;
}

export class NotificationMetrics {
  private emailSent = 0;
  private emailFailed = 0;
  private otpResend = 0;
  private passwordResetRequests = 0;

  recordDelivery(_channel: "email", success: boolean): void {
    if (success) {
      this.emailSent += 1;
    } else {
      this.emailFailed += 1;
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
      otpResend: this.otpResend,
      passwordResetRequests: this.passwordResetRequests,
    };
  }
}
