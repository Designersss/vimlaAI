import type { ReactElement } from "react";
import { OperatorWorkspace } from "../../../features/operator/components/OperatorWorkspace";
import { CONSUMER_FEATURES } from "../../../shared/config/consumer-features";
import { notFound } from "next/navigation";

export default function VimlaOperatorPage(): ReactElement {
  if (!CONSUMER_FEATURES.vimlaOperator) {
    notFound();
  }
  return <OperatorWorkspace />;
}
