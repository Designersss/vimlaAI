"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ChatWorkspaceStore } from "../../stores/chat-workspace-store";
import { ensureLocalDevice } from "../../../direct-chats/services/session";

const ChatWorkspaceContext = createContext<ChatWorkspaceStore | null>(null);
const PrepareDeviceContext = createContext<(() => Promise<void>) | null>(null);

export function ChatWorkspaceProvider({ children }: { children: ReactNode }): ReactElement {
  const [store] = useState(() => new ChatWorkspaceStore());
  const pendingDevice = useRef<Promise<void> | null>(null);
  // The persistent list and a deep-linked direct detail can mount together. Serialize
  // their existing browser-device setup here, without moving crypto into the store.
  const prepareDevice = useCallback((): Promise<void> => {
    pendingDevice.current ??= ensureLocalDevice().then(() => undefined).finally(() => {
      pendingDevice.current = null;
    });
    return pendingDevice.current;
  }, []);
  return (
    <ChatWorkspaceContext.Provider value={store}>
      <PrepareDeviceContext.Provider value={prepareDevice}>{children}</PrepareDeviceContext.Provider>
    </ChatWorkspaceContext.Provider>
  );
}

export function useChatWorkspace(): ChatWorkspaceStore {
  const store = useContext(ChatWorkspaceContext);
  if (!store) throw new Error("ChatWorkspaceProvider is required");
  return store;
}

export function usePrepareChatDevice(): () => Promise<void> {
  const prepare = useContext(PrepareDeviceContext);
  if (!prepare) throw new Error("ChatWorkspaceProvider is required");
  return prepare;
}
