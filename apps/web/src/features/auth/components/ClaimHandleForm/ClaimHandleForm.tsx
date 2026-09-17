"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { handleInputSchema, normalizeHandleInput } from "@vimla/contracts";
import { Alert, Button, FormField, Input } from "@vimla/ui";
import { AuthRequiredError, fetchCurrentUser } from "../../services/current-user";
import {
  checkHandleAvailability,
  claimHandle,
  HandleUnavailableError,
} from "../../services/handles";

export function ClaimHandleForm(): ReactElement {
  const router = useRouter();
  const t = useTranslations();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void fetchCurrentUser()
      .then(async (current) => {
        if (!current.emailVerified) {
          sessionStorage.setItem("vimla.verifyEmail", current.email);
          await router.replace("/verify-email");
          return;
        }
        if (!current.handleRequired) {
          await router.replace("/app");
          return;
        }
        setReady(true);
      })
      .catch(async (cause: unknown) => {
        if (cause instanceof AuthRequiredError) {
          await router.replace("/sign-in");
          return;
        }
        setError(t("errors.generic"));
        setReady(true);
      });
  }, [router, t]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const parsed = handleInputSchema.safeParse(handle);
    if (!parsed.success) {
      setError(t("validation.required"));
      return;
    }

    setSubmitting(true);
    try {
      const availability = await checkHandleAvailability(parsed.data);
      if (!availability.available) {
        setError(t("auth.errors.registrationFailed"));
        return;
      }
      await claimHandle(parsed.data);
      const current = await fetchCurrentUser();
      if (!current.emailVerified || current.handleStatus === "PENDING") {
        sessionStorage.setItem("vimla.verifyEmail", current.email);
        await router.replace("/verify-email");
      } else {
        await router.replace("/app");
      }
      router.refresh();
    } catch (cause: unknown) {
      if (cause instanceof HandleUnavailableError) {
        setError(t("auth.errors.registrationFailed"));
      } else {
        setError(t("errors.generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return <Alert>{t("common.loading")}</Alert>;
  }

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)}>
      <FormField label="@login" htmlFor="claim-handle" error={error ?? undefined}>
        <Input
          id="claim-handle"
          name="handle"
          autoComplete="username"
          value={handle}
          invalid={Boolean(error)}
          onChange={(event) => {
            setHandle(normalizeHandleInput(event.target.value));
            setError(null);
          }}
        />
      </FormField>
      <Button type="submit" block loading={submitting} disabled={submitting}>
        {t("common.continue")}
      </Button>
    </form>
  );
}
