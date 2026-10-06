"use client";

import {
  useEffect,
  useState,
  type ChangeEvent,
  type ReactElement,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PublicProfile } from "@vimla/contracts/public-profiles";
import {
  Alert,
  Avatar,
  EmptyState,
  Heading,
  PageHeader,
  SearchInput,
  Spinner,
  buttonClassName,
} from "@vimla/ui";
import {
  AuthRequiredError,
  fetchCurrentUser,
} from "../../auth/services/current-user";
import { searchPeople } from "../../chat/services/people";
import styles from "./PublicProfile.module.scss";

function profilePath(handle: string): string {
  return `/app/profile/${encodeURIComponent(handle)}`;
}

export function PeopleDirectory(): ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [myHandle, setMyHandle] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [identityFailed, setIdentityFailed] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser()
      .then((user) => {
        if (cancelled) {
          return;
        }
        setUserId(user.id);
        setMyHandle(user.handle);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof AuthRequiredError) {
          router.replace("/sign-in");
          return;
        }
        setIdentityFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const value = query.trim();
    if (value.length === 0 || value === "@") {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setSearchFailed(false);
      void searchPeople(value)
        .then((response) => {
          if (cancelled) {
            return;
          }
          setResults(
            response.items.filter(
              (profile) => profile.userId !== userId,
            ),
          );
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          if (error instanceof AuthRequiredError) {
            router.replace("/sign-in");
            return;
          }
          setResults([]);
          setSearchFailed(true);
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, router, userId]);

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextQuery = event.target.value;
    setQuery(nextQuery);
    setResults([]);
    setLoading(false);
    setSearchFailed(false);
  }

  const normalizedQuery = query.trim();
  const hasSearch =
    normalizedQuery.length > 0 && normalizedQuery !== "@";
  const failed = identityFailed || searchFailed;

  return (
    <section
      className={styles.page}
      data-testid="people-directory"
    >
      <div className={styles.content}>
        <PageHeader
          title={
            <Heading as="h1" size="page">
              {t("profile.directoryTitle")}
            </Heading>
          }
          description={
            <p className={styles.secondary}>
              {t("profile.directoryDescription")}
            </p>
          }
          actions={
            myHandle ? (
              <Link
                href={profilePath(myHandle)}
                scroll={false}
                className={buttonClassName({
                  variant: "secondary",
                })}
              >
                {t("profile.myProfile")}
              </Link>
            ) : undefined
          }
        />

        <SearchInput
          aria-label={t("profile.search")}
          placeholder={t("profile.search")}
          value={query}
          onChange={handleQueryChange}
          autoComplete="off"
        />

        {loading ? (
          <p className={styles.statusRow}>
            <Spinner label={t("common.loading")} />
          </p>
        ) : null}

        {failed ? (
          <Alert variant="error">
            {t("common.genericError")}
          </Alert>
        ) : null}

        {!hasSearch && !loading && !failed ? (
          <EmptyState
            title={t("profile.searchPrompt")}
            description={t("profile.directoryDescription")}
          />
        ) : null}

        {hasSearch &&
        !loading &&
        !failed &&
        results.length === 0 ? (
          <EmptyState title={t("profile.noResults")} />
        ) : null}

        {hasSearch && results.length > 0 ? (
          <div
            className={styles.results}
            data-testid="people-directory-results"
          >
            {results.map((profile) => (
              <Link
                key={profile.userId}
                href={profilePath(profile.handle)}
                scroll={false}
                className={styles.personCard}
              >
                <Avatar
                  name={profile.displayName}
                  src={profile.avatarUrl}
                />
                <span className={styles.personIdentity}>
                  <strong>{profile.displayName}</strong>
                  <span className={styles.handle}>
                    @{profile.handle}
                  </span>
                  {profile.status ? (
                    <span className={styles.secondary}>
                      {profile.status}
                    </span>
                  ) : null}
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
