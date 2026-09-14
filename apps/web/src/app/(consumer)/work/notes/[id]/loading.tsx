import type { ReactElement } from "react";
import { WorkDetailLoading } from "../../../../../features/workspace/components/WorkDetailStatus";

export default function WorkNoteLoading(): ReactElement {
  return <WorkDetailLoading kind="notes" />;
}
