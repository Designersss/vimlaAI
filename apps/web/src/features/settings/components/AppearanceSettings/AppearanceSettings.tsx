"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, Card, FormField, Heading, Input, Radio, Text, useAppearance, type Appearance } from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser, updatePreferences } from "../../../auth/services/current-user";
import { suggestedTimeZone } from "../../../workspace/services/datetime";
import { SettingsChrome } from "../SettingsChrome/SettingsChrome";

export function AppearanceSettings(): ReactElement {
  const t = useTranslations();
  const { appearance, setAppearance } = useAppearance();
  const [timezone, setTimezone] = useState<string | null>(null);
  const [draft, setDraft] = useState(suggestedTimeZone());
  const [message, setMessage] = useState<"saved" | "error" | null>(null);

  useEffect(() => {
    void fetchCurrentUser()
      .then((user) => {
        setTimezone(user.timezone);
        setDraft(user.timezone ?? suggestedTimeZone());
      })
      .catch((error: unknown) => {
        if (error instanceof AuthRequiredError) {
          return;
        }
        setMessage("error");
      });
  }, []);

  function option(value: Appearance, label: string): ReactElement {
    return (
      <Radio
        name="appearance"
        value={value}
        checked={appearance === value}
        label={label}
        onChange={() => {
          setAppearance(value);
        }}
      />
    );
  }

  async function onSaveTimezone(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    try {
      const user = await updatePreferences({ timezone: draft });
      setTimezone(user.timezone);
      setMessage("saved");
    } catch {
      setMessage("error");
    }
  }

  return (
    <SettingsChrome title={t("settings.appearanceTitle")}>
      <Card>
        <Heading as="h2" size="section">
          {t("appearance.theme")}
        </Heading>
        <Text tone="secondary">{t("appearance.description")}</Text>
        {option("light", t("appearance.light"))}
        {option("dark", t("appearance.dark"))}
        {option("system", t("appearance.system"))}
      </Card>
      <Card>
        <Heading as="h2" size="section">
          {t("appearance.timezone")}
        </Heading>
        <Text tone="secondary">{t("appearance.timezoneDescription")}</Text>
        {timezone ? <Text>{timezone}</Text> : <Text>{t("appearance.timezoneSuggestion", { zone: suggestedTimeZone() })}</Text>}
        <form onSubmit={(event) => void onSaveTimezone(event)}>
          <FormField label={t("appearance.timezone")} htmlFor="user-timezone">
            <Input
              id="user-timezone"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              required
            />
          </FormField>
          <Button type="submit">{t("appearance.timezoneConfirm")}</Button>
        </form>
        {message === "saved" ? <Alert variant="success">{t("appearance.timezoneSaved")}</Alert> : null}
        {message === "error" ? <Alert variant="error">{t("common.genericError")}</Alert> : null}
      </Card>
    </SettingsChrome>
  );
}
