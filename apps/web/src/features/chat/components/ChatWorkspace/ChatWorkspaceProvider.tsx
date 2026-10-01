"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type { SyncDelta } from "@vimla/contracts";
import { ChatWorkspaceStore } from "@vimla/client-core";
import { ensureLocalDevice } from "../../../direct-chats/services/session";

const ChatWorkspaceContext =
  createContext<ChatWorkspaceStore | null>(null);
const PrepareDeviceContext =
  createContext<(() => Promise<void>) | null>(null);

type SyncDeltaListener = (
  deltas: readonly SyncDelta[],
) => Promise<void> | void;

interface ChatSyncHub {
  publish(
    deltas: readonly SyncDelta[],
  ): Promise<void>;
  subscribe(listener: SyncDeltaListener): () => void;
}

const ChatSyncContext =
  createContext<ChatSyncHub | null>(null);

export function ChatWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const [store] = useState(
    () => new ChatWorkspaceStore(),
  );
  const pendingDevice =
    useRef<Promise<void> | null>(null);
  const syncListeners = useRef(
    new Set<SyncDeltaListener>(),
  );

  // The persistent list and a deep-linked direct detail can mount together. Serialize
  // their existing browser-device setup here, without moving crypto into the store.
  const prepareDevice =
    useCallback((): Promise<void> => {
      pendingDevice.current ??=
        ensureLocalDevice()
          .then(() => undefined)
          .finally(() => {
            pendingDevice.current = null;
          });
      return pendingDevice.current;
    }, []);

  const subscribeSync = useCallback(
    (listener: SyncDeltaListener): (() => void) => {
      syncListeners.current.add(listener);
      return () => {
        syncListeners.current.delete(listener);
      };
    },
    [],
  );
  const publishSync = useCallback(
    async (
      deltas: readonly SyncDelta[],
    ): Promise<void> => {
      for (const listener of [
        ...syncListeners.current,
      ]) {
        await listener(deltas);
      }
    },
    [],
  );
  const syncHub = useMemo<ChatSyncHub>(
    () => ({
      publish: publishSync,
      subscribe: subscribeSync,
    }),
    [publishSync, subscribeSync],
  );

  return (
    <ChatWorkspaceContext.Provider value={store}>
      <PrepareDeviceContext.Provider
        value={prepareDevice}
      >
        <ChatSyncContext.Provider value={syncHub}>
          {children}
        </ChatSyncContext.Provider>
      </PrepareDeviceContext.Provider>
    </ChatWorkspaceContext.Provider>
  );
}

export function useChatWorkspace(): ChatWorkspaceStore {
  const store = useContext(ChatWorkspaceContext);
  if (!store) {
    throw new Error(
      "ChatWorkspaceProvider is required",
    );
  }
  return store;
}

export function usePrepareChatDevice(): () => Promise<void> {
  const prepare = useContext(PrepareDeviceContext);
  if (!prepare) {
    throw new Error(
      "ChatWorkspaceProvider is required",
    );
  }
  return prepare;
}

export function useChatSyncHub(): ChatSyncHub {
  const sync = useContext(ChatSyncContext);
  if (!sync) {
    throw new Error(
      "ChatWorkspaceProvider is required",
    );
  }
  return sync;
}
