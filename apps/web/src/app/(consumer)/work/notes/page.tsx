import type { ReactElement } from "react";
import { WorkCollectionHome } from "../../../../features/workspace/components/WorkCollectionHome";

export default function WorkNotesPage(): ReactElement {
  return <WorkCollectionHome kind="notes" />;
}
