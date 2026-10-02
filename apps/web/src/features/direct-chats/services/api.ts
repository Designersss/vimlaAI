import type {
  CreateDirectConversation,
  CryptoDeviceView,
  DirectConversationView,
  DirectMessageView,
  DirectMessagesResponse,
  PrekeyBundlesResponse,
  RegisterCryptoDevice,
  SendDirectMessage,
  UpdateDirectChatPrivacy,
} from "@vimla/contracts";
import { DirectChatsApiError } from "@vimla/client-api";
import { createWebClientApi } from "../../../shared/api/client";
import { clearLocalE2eeData } from "./crypto-store";
import { markLocalDeviceRevoked } from "./revocation-state";

export { DirectChatsApiError };

const DIRECT_CHAT_REQUEST_TIMEOUT_MS = 20_000;

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(DIRECT_CHAT_REQUEST_TIMEOUT_MS);
}

async function wipeAfterCurrentDeviceRevocation(
  error: unknown,
): Promise<never> {
  if (
    error instanceof DirectChatsApiError &&
    error.code === "direct_chat_device_revoked"
  ) {
    markLocalDeviceRevoked();
    await clearLocalE2eeData();
  }
  throw error;
}

export async function fetchDirectConversation(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectConversationView> {
  return createWebClientApi(fetchImpl).directChats.fetchDirectConversation(
    id,
    { signal: timeoutSignal() },
  );
}

export async function createDirectConversation(
  input: CreateDirectConversation,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectConversationView> {
  return createWebClientApi(fetchImpl).directChats.createDirectConversation(
    input,
    { signal: timeoutSignal() },
  );
}

export async function updateDirectChatPrivacy(
  id: string,
  input: UpdateDirectChatPrivacy,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectConversationView> {
  return createWebClientApi(fetchImpl).directChats.updateDirectChatPrivacy(
    id,
    input,
    { signal: timeoutSignal() },
  );
}

export async function markDirectChatRead(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectConversationView> {
  return createWebClientApi(fetchImpl).directChats.markDirectChatRead(
    id,
    { signal: timeoutSignal() },
  );
}

export async function fetchDirectMessages(
  id: string,
  deviceId: string,
  cursor?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectMessagesResponse> {
  try {
    return await createWebClientApi(fetchImpl).directChats.fetchDirectMessages(
      id,
      deviceId,
      cursor,
      { signal: timeoutSignal() },
    );
  } catch (error: unknown) {
    return wipeAfterCurrentDeviceRevocation(error);
  }
}

export async function sendDirectMessage(
  id: string,
  input: SendDirectMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectMessageView> {
  try {
    return await createWebClientApi(fetchImpl).directChats.sendDirectMessage(
      id,
      input,
      { signal: timeoutSignal() },
    );
  } catch (error: unknown) {
    return wipeAfterCurrentDeviceRevocation(error);
  }
}

export async function registerCryptoDevice(
  input: RegisterCryptoDevice,
  fetchImpl: typeof fetch = fetch,
): Promise<CryptoDeviceView> {
  return createWebClientApi(fetchImpl).directChats.registerCryptoDevice(
    input,
    { signal: timeoutSignal() },
  );
}

export async function revokeCryptoDevice(
  deviceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CryptoDeviceView> {
  return createWebClientApi(fetchImpl).directChats.revokeCryptoDevice(
    deviceId,
    { signal: timeoutSignal() },
  );
}

export async function fetchMyCryptoDevices(
  fetchImpl: typeof fetch = fetch,
): Promise<CryptoDeviceView[]> {
  return createWebClientApi(fetchImpl).directChats.fetchMyCryptoDevices({
    signal: timeoutSignal(),
  });
}

export async function fetchPrekeyBundles(
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PrekeyBundlesResponse> {
  return createWebClientApi(fetchImpl).directChats.fetchPrekeyBundles(
    userId,
    { signal: timeoutSignal() },
  );
}
