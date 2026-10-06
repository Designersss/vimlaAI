import { describe, expect, it } from "vitest";
import {
  createAbuseReportSchema,
  directMessageReportEvidenceSchema,
  TRUST_LIMITS,
  updateSurfacePreferenceSchema,
} from "./trust.js";

describe("trust contracts", () => {
  it("accepts bounded typed reports without accepting reporter identity", () => {
    expect(
      createAbuseReportSchema.parse({
        targetHandle: "peer",
        reason: "HARASSMENT",
        details: "Repeated harassment",
      }),
    ).toEqual({
      targetHandle: "peer",
      reason: "HARASSMENT",
      details: "Repeated harassment",
    });

    expect(() =>
      createAbuseReportSchema.parse({
        targetHandle: "peer",
        reason: "HARASSMENT",
        reporterUserId: "forged-user",
      }),
    ).toThrow();

    expect(() =>
      createAbuseReportSchema.parse({
        targetHandle: "peer",
        reason: "OTHER",
        details: "x".repeat(TRUST_LIMITS.reportDetailsMax + 1),
      }),
    ).toThrow();
  });

  it("requires explicit bounded plaintext for E2EE Direct Chat evidence", () => {
    const evidence = {
      kind: "DIRECT_MESSAGE" as const,
      conversationId: "11111111-1111-4111-8111-111111111111",
      messageId: "22222222-2222-4222-8222-222222222222",
      disclosedText: "Selected plaintext supplied by the reporting client",
    };
    expect(directMessageReportEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(() =>
      directMessageReportEvidenceSchema.parse({
        ...evidence,
        disclosedText: "",
      }),
    ).toThrow();
    expect(() =>
      directMessageReportEvidenceSchema.parse({
        ...evidence,
        disclosedText: "x".repeat(TRUST_LIMITS.evidenceTextMax + 1),
      }),
    ).toThrow();
  });

  it("keeps surface mute mutation narrow and strict", () => {
    expect(updateSurfacePreferenceSchema.parse({ muted: true })).toEqual({
      muted: true,
    });
    expect(() =>
      updateSurfacePreferenceSchema.parse({
        muted: true,
        archived: true,
      }),
    ).toThrow();
  });
});
