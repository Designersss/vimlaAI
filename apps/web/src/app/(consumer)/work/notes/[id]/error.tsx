"use client";

import type { ReactElement } from "react";
import { WorkDetailFailure } from "../../../../../features/workspace/components/WorkDetailStatus";

export default function WorkNoteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  void error;
  return <WorkDetailFailure kind="notes" reset={reset} />;
}
