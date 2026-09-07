import type { HttpFetch } from "./types.js";

export function createNativeHttpTransport(): HttpFetch {
  return async (input, init) => fetch(input, init);
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
