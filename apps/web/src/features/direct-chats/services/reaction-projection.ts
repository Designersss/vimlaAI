import {
  projectVerifiedDirectReactions,
  type DirectReactionsProjection,
  type ReactionProjectionRow,
} from "@vimla/client-core";
import { loadPlaintext } from "./crypto-store";

/** Web storage adapter; protocol authority lives in platform-neutral client-core. */
export function projectDirectReactions(
  rows: readonly ReactionProjectionRow[],
  authoritativeHeadSequence: string,
): Promise<DirectReactionsProjection> {
  return projectVerifiedDirectReactions(rows, loadPlaintext, authoritativeHeadSequence);
}

export type { DirectReactionsProjection, ReactionProjectionRow };
