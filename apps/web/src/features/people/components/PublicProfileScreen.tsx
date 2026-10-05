"use client";

import {
  useEffect,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PublicProfile } from "@vimla/contracts/public-profiles";
import { navigationTargetToWebPath } from "@vimla/web-navigation";
import {
  Alert,
  Avatar,
  Button,
  Card,
  ErrorState,
  FormField,
  Heading,
  Input,
  PageHeader,
  Spinner,
  Textarea,
  buttonClassName,
} from "@vimla/ui";
import {
  AuthRequiredError,
  fetchCurrentUser,
} from "../../auth/services/current-user";
import {
  fetchPublicProfile,
  updateMyPublicProfile,
} from "../../chat/services/people";
import { createDirectConversation } from "../../direct-chats/services/api";
import { ensureLocalDevice } from "../../direct-chats/services/session";
import { CONSUMER_FEATURES } from "../../../shared/config/consumer-features";
import styles from "./PublicProfile.module.scss";

type LoadState = "loading" | "ready" | "failed";

export function PublicProfileScreen({
  handle,
}: {
  handle: string;
}): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [boot, setBoot] = useState<LoadState>("loading");
  const [loadedHandle, setLoadedHandle] = useState<string | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [startFailed, setStartFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      fetchCurrentUser(),
      fetchPublicProfile(handle),
    ])
      .then(([user, nextProfile]) => {
        if (cancelled) {
          return;
        }
        setCurrentUserId(user.id);
        setProfile(nextProfile);
        setDisplayName(nextProfile.displayName);
        setStatus(nextProfile.status ?? "");
        setBio(nextProfile.bio ?? "");
        setEditing(false);
        setSaveFailed(false);
        setSaved(false);
        setStartFailed(false);
        setLoadedHandle(handle);
        setBoot("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setProfile(null);
        setLoadedHandle(handle);
        setBoot("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, handle, router]);

  function resetEditor(nextProfile: PublicProfile): void {
    setDisplayName(nextProfile.displayName);
    setStatus(nextProfile.status ?? "");
    setBio(nextProfile.bio ?? "");
    setSaveFailed(false);
    setSaved(false);
  }

  function retryLoad(): void {
    setBoot("loading");
    setLoadedHandle(null);
    setSaveFailed(false);
    setSaved(false);
    setStartFailed(false);
    setAttempt((value) => value + 1);
  }

  async function saveProfile(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (saving || !profile || currentUserId !== profile.userId) {
      return;
    }
    setSaving(true);
    setSaveFailed(false);
    setSaved(false);
    try {
      const updated = await updateMyPublicProfile({
        displayName,
        status,
        bio,
      });
      setProfile(updated);
      resetEditor(updated);
      setEditing(false);
      setSaved(true);
    } catch (error: unknown) {
      if (error instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  async function startDirectChat(): Promise<void> {
    if (startingChat || !profile) {
      return;
    }
    setStartingChat(true);
    setStartFailed(false);
    try {
      await ensureLocalDevice();
      const created = await createDirectConversation({
        peerHandle: profile.handle,
      });
      router.push(
        navigationTargetToWebPath({
          version: 1,
          kind: "CHAT",
          id: created.surfaceId,
        }),
        { scroll: false },
      );
    } catch (error: unknown) {
      if (error instanceof AuthRequiredError) {
        router.replace("/sign-in");
        return;
      }
      setStartFailed(true);
    } finally {
      setStartingChat(false);
    }
  }

  if (boot === "loading" || loadedHandle !== handle) {
    return (
      <section className={styles.page}>
        <p className={styles.statusRow}>
          <Spinner label={t("profile.loading")} />
        </p>
      </section>
    );
  }

  if (boot === "failed" || !profile) {
    return (
      <section className={styles.page}>
        <div className={styles.content}>
          <ErrorState
            title={t("profile.unavailable")}
            action={
              <Button onClick={retryLoad}>
                {t("common.retry")}
              </Button>
            }
          />
          <Link
            href="/app/people"
            scroll={false}
            className={buttonClassName({
              variant: "ghost",
              size: "sm",
            })}
          >
            {t("profile.backToPeople")}
          </Link>
        </div>
      </section>
    );
  }

  const isOwner = currentUserId === profile.userId;

  return (
    <section
      className={styles.page}
      data-testid="public-profile-screen"
    >
      <div className={styles.content}>
        <Link
          href="/app/people"
          scroll={false}
          className={buttonClassName({
            variant: "ghost",
            size: "sm",
          })}
        >
          {t("profile.backToPeople")}
        </Link>

        <PageHeader
          title={
            <Heading as="h1" size="page">
              {profile.displayName}
            </Heading>
          }
          actions={
            isOwner ? (
              <Button
                variant="secondary"
                onClick={() => {
                  resetEditor(profile);
                  setEditing((value) => !value);
                }}
              >
                {editing
                  ? t("common.cancel")
                  : t("profile.edit")}
              </Button>
            ) : CONSUMER_FEATURES.directChats ? (
              <Button
                disabled={startingChat}
                onClick={() => void startDirectChat()}
              >
                {t("profile.startChat")}
              </Button>
            ) : undefined
          }
        />

        {saved ? (
          <Alert variant="success">
            {t("profile.saveSuccess")}
          </Alert>
        ) : null}
        {saveFailed ? (
          <Alert variant="error">
            {t("profile.saveFailed")}
          </Alert>
        ) : null}
        {startFailed ? (
          <Alert variant="error">
            {t("profile.startFailed")}
          </Alert>
        ) : null}

        <Card className={styles.hero}>
          <div className={styles.avatarWrap}>
            <Avatar
              name={profile.displayName}
              src={profile.avatarUrl}
            />
          </div>
          <div className={styles.identity}>
            <strong>{profile.displayName}</strong>
            <span className={styles.handle}>
              @{profile.handle}
            </span>
            {profile.status ? (
              <span className={styles.statusText}>
                {profile.status}
              </span>
            ) : null}
            {isOwner ? (
              <span className={styles.secondary}>
                {t("profile.you")}
              </span>
            ) : null}
          </div>
        </Card>

        {editing && isOwner ? (
          <Card>
            <form
              className={styles.form}
              onSubmit={(event) => void saveProfile(event)}
            >
              <FormField
                label={t("profile.displayName")}
                htmlFor="profile-display-name"
              >
                <Input
                  id="profile-display-name"
                  value={displayName}
                  maxLength={80}
                  onChange={(event) =>
                    setDisplayName(event.target.value)
                  }
                  required
                />
              </FormField>
              <FormField
                label={t("profile.status")}
                htmlFor="profile-status"
              >
                <Input
                  id="profile-status"
                  value={status}
                  maxLength={80}
                  onChange={(event) =>
                    setStatus(event.target.value)
                  }
                />
              </FormField>
              <FormField
                label={t("profile.bio")}
                htmlFor="profile-bio"
              >
                <Textarea
                  id="profile-bio"
                  value={bio}
                  maxLength={280}
                  rows={5}
                  onChange={(event) =>
                    setBio(event.target.value)
                  }
                />
              </FormField>
              <div className={styles.readOnlyField}>
                <span>{t("profile.handle")}</span>
                <strong>@{profile.handle}</strong>
              </div>
              <p className={styles.secondary}>
                {t("profile.avatarManaged")}
              </p>
              <div className={styles.formActions}>
                <Button
                  type="submit"
                  disabled={
                    saving || displayName.trim().length === 0
                  }
                >
                  {t("common.save")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    resetEditor(profile);
                    setEditing(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          </Card>
        ) : (
          <Card className={styles.bioCard}>
            <Heading as="h2" size="section">
              {t("profile.bio")}
            </Heading>
            <p className={styles.bio}>
              {profile.bio ?? t("profile.noBio")}
            </p>
          </Card>
        )}
      </div>
    </section>
  );
}
