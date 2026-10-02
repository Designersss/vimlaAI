"use client";

import {
  useEffect,
  useState,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import {
  AuthRequiredError,
} from "../../../auth/services/current-user";
import {
  fetchInboxItem,
} from "../../services/inbox";
import {
  ChatDetailStatus,
} from "./ChatDetailStatus";

export function SurfaceChatRedirect({
  surfaceId,
}: {
  surfaceId: string;
}): ReactElement {
  const router = useRouter();
  const [attempt, setAttempt] =
    useState(0);
  const [failed, setFailed] =
    useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    void fetchInboxItem(surfaceId)
      .then((item) => {
        if (cancelled) {
          return;
        }
        router.replace(
          item.surfaceKind ===
            "AI_THREAD"
            ? `/app/${item.domainId}`
            : `/app/direct/${item.domainId}`,
          { scroll: false },
        );
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (
          error instanceof
          AuthRequiredError
        ) {
          router.replace("/sign-in");
          return;
        }
        setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, router, surfaceId]);

  return (
    <ChatDetailStatus
      failed={failed}
      retry={
        failed
          ? () =>
              setAttempt(
                (value) => value + 1,
              )
          : undefined
      }
    />
  );
}
