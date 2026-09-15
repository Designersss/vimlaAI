"use client";

import type { ReactElement } from "react";
import { WorkRouteFailure } from "../../../features/workspace/components/WorkRouteStatus";

export default function WorkError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  void error;
  return <WorkRouteFailure reset={reset} />;
}
