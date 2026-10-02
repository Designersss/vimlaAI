import type {
  ReactElement,
} from "react";
import {
  SurfaceChatRedirect,
} from "../../../../../features/chat/components/ChatWorkspace/SurfaceChatRedirect";

export default async function SurfaceChatPage({
  params,
}: {
  params: Promise<{
    surfaceId: string;
  }>;
}): Promise<ReactElement> {
  const { surfaceId } = await params;
  return (
    <SurfaceChatRedirect
      key={surfaceId}
      surfaceId={surfaceId}
    />
  );
}
