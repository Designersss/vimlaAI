import { DirectChatError } from "./errors.js";

export function directPairKey(userIdA: string, userIdB: string): string {
  if (userIdA === userIdB) {
    throw new DirectChatError("VALIDATION_ERROR", "A Direct Chat requires two distinct users");
  }
  return [userIdA, userIdB].sort().join(":");
}
