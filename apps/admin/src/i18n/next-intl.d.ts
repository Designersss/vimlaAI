import type ru from "../../messages/ru.json";

type Messages = typeof ru;

declare module "next-intl" {
  interface AppConfig {
    Locale: "ru" | "en";
    Messages: Messages;
  }
}
