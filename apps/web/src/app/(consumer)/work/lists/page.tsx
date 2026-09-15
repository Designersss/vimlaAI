import type { ReactElement } from "react";
import { WorkCollectionHome } from "../../../../features/workspace/components/WorkCollectionHome";

export default function WorkListsPage(): ReactElement {
  return <WorkCollectionHome kind="lists" />;
}
