import type { ReactElement } from "react";
import { WorkDetailLoading } from "../../../../../features/workspace/components/WorkDetailStatus";

export default function WorkListLoading(): ReactElement {
  return <WorkDetailLoading kind="lists" />;
}
