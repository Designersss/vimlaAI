import {
  MemoryError,
  type MemoryCandidateInput,
  type MemoryService,
  type MemoryView,
} from "./memory.js";
import { containsSensitiveContextData } from "./packer.js";

export type MemoryExtractionSkipReason =
  | "TRANSIENT"
  | "LOW_CONFIDENCE"
  | "SENSITIVE"
  | "E2EE_AUTOMATIC_DISABLED";

export type MemoryExtractionResult =
  | { kind: "STORED"; memory: MemoryView }
  | {
      kind: "SKIPPED";
      reason: MemoryExtractionSkipReason;
    };

export interface AutomaticMemoryProposal
  extends Omit<
    MemoryCandidateInput,
    "origin" | "userConfirmed" | "userCorrected"
  > {
  transient?: boolean;
}

export class MemoryExtractionPipeline {
  constructor(private readonly memory: MemoryService) {}

  async process(
    proposal: AutomaticMemoryProposal,
  ): Promise<MemoryExtractionResult> {
    if (proposal.transient === true) {
      return { kind: "SKIPPED", reason: "TRANSIENT" };
    }
    if ((proposal.confidence ?? 0.8) < 0.5) {
      return { kind: "SKIPPED", reason: "LOW_CONFIDENCE" };
    }
    if (
      proposal.sourceRefs.some(
        (ref) =>
          ref.sourceScopeKind === "DIRECT_CHAT" ||
          ref.sourceType === "E2EE_USER_DISCLOSURE",
      )
    ) {
      return {
        kind: "SKIPPED",
        reason: "E2EE_AUTOMATIC_DISABLED",
      };
    }
    if (
      containsSensitiveContextData({
        content: proposal.content,
      })
    ) {
      return { kind: "SKIPPED", reason: "SENSITIVE" };
    }

    try {
      const memory = await this.memory.ingestCandidate({
        ...proposal,
        origin: "AUTO_EXTRACTION",
      });
      return { kind: "STORED", memory };
    } catch (error: unknown) {
      if (
        error instanceof MemoryError &&
        error.code === "SENSITIVE_CONTENT"
      ) {
        return { kind: "SKIPPED", reason: "SENSITIVE" };
      }
      throw error;
    }
  }
}
