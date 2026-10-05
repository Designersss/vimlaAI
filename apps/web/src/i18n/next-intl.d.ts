import type ru from "../../messages/ru.json";
import type profileRu from "../../messages/profile-ru.json";

type Messages = typeof ru & {
  profile: typeof profileRu;
};

declare module "next-intl" {
  interface AppConfig {
    Locale: "ru" | "en";
    Messages: Messages;
  }
}
