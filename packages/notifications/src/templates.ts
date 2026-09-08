import type { VimlaLocale } from "@vimla/shared";
import type { EmailTemplateId, SmsTemplateId } from "./types.js";

interface EmailTemplateInput {
  otp?: string;
  resetUrl?: string;
}

interface RenderedEmail {
  subject: string;
  text: string;
}

const EMAIL_TEMPLATES: Record<
  EmailTemplateId,
  Record<VimlaLocale, (input: EmailTemplateInput) => RenderedEmail>
> = {
  emailVerificationOtp: {
    ru: ({ otp }) => ({
      subject: "Код подтверждения Vimla",
      text: `Ваш код подтверждения Vimla: ${otp ?? ""}\nОн действует 5 минут. Если вы не регистрировались, проигнорируйте это письмо.`,
    }),
    en: ({ otp }) => ({
      subject: "Vimla verification code",
      text: `Your Vimla verification code is ${otp ?? ""}.\nIt expires in 5 minutes. If you did not create an account, ignore this email.`,
    }),
  },
  passwordReset: {
    ru: ({ resetUrl }) => ({
      subject: "Сброс пароля Vimla",
      text: `Чтобы задать новый пароль Vimla, откройте ссылку:\n${resetUrl ?? ""}\nСсылка одноразовая и действует ограниченное время. Если вы не запрашивали сброс, проигнорируйте это письмо.`,
    }),
    en: ({ resetUrl }) => ({
      subject: "Reset your Vimla password",
      text: `Set a new Vimla password using this link:\n${resetUrl ?? ""}\nThe link is single-use and expires soon. If you did not request a reset, ignore this email.`,
    }),
  },
  securityPasswordChanged: {
    ru: () => ({
      subject: "Пароль Vimla изменён",
      text: "Пароль вашего аккаунта Vimla был изменён. Все предыдущие сессии завершены. Если это были не вы, восстановите доступ через сброс пароля.",
    }),
    en: () => ({
      subject: "Your Vimla password was changed",
      text: "The password for your Vimla account was changed. Previous sessions were signed out. If this was not you, reset your password immediately.",
    }),
  },
  changeEmailOtp: {
    ru: ({ otp }) => ({
      subject: "Код для смены email Vimla",
      text: `Код для подтверждения смены email: ${otp ?? ""}\nОн действует 5 минут.`,
    }),
    en: ({ otp }) => ({
      subject: "Vimla email change code",
      text: `Your email-change verification code is ${otp ?? ""}.\nIt expires in 5 minutes.`,
    }),
  },
};

const SMS_TEMPLATES: Record<
  SmsTemplateId,
  Record<VimlaLocale, (otp: string) => string>
> = {
  phoneVerificationOtp: {
    ru: (otp) => `Код Vimla: ${otp}. Действует 5 минут.`,
    en: (otp) => `Vimla code: ${otp}. Expires in 5 minutes.`,
  },
};

export function renderEmailTemplate(
  templateId: EmailTemplateId,
  locale: VimlaLocale,
  input: EmailTemplateInput,
): RenderedEmail {
  return EMAIL_TEMPLATES[templateId][locale](input);
}

export function renderSmsTemplate(
  templateId: SmsTemplateId,
  locale: VimlaLocale,
  otp: string,
): string {
  return SMS_TEMPLATES[templateId][locale](otp);
}
