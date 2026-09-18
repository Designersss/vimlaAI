import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vimla/database";
import { seedVimlaAiModels } from "./seed-models.js";

describe("seedVimlaAiModels", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a replacement frozen price version when the old one is closed", async () => {
    const now = new Date("2026-09-18T21:15:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const upsert = vi
      .fn()
      .mockImplementation(async ({ where }: { where: { slug: string } }) => ({
        id: `model:${where.slug}`,
      }));
    const findFirst = vi.fn().mockResolvedValue({
      id: "current-price",
      inputMicroRubPerMillion: 1n,
      outputMicroRubPerMillion: 1n,
      cacheReadMicroRubPerMillion: null,
      cacheWriteMicroRubPerMillion: null,
    });
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn().mockResolvedValue({});

    const prisma = {
      aiModel: { upsert },
      aiModelPriceVersion: { findFirst, update, create },
    } as unknown as PrismaClient;

    await seedVimlaAiModels(prisma);

    expect(update).toHaveBeenCalled();
    for (const call of update.mock.calls) {
      expect(call[0].data.effectiveTo).toEqual(now);
    }
    expect(create).toHaveBeenCalled();
    for (const call of create.mock.calls) {
      expect(call[0].data.effectiveFrom).toEqual(now);
      expect(call[0].data.verifiedAt.getTime()).toBeLessThanOrEqual(
        call[0].data.effectiveFrom.getTime(),
      );
    }
  });
});
