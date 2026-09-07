import type { PrismaClient } from "@vimla/database";
import { VIMLA_AI_MODEL_CATALOG } from "./catalog.js";

export async function seedVimlaAiModels(prisma: PrismaClient): Promise<void> {
  const now = new Date();

  for (const entry of VIMLA_AI_MODEL_CATALOG) {
    const model = await prisma.aiModel.upsert({
      where: { slug: entry.slug },
      update: {
        displayName: entry.displayName,
        vendor: entry.vendor,
        provider: entry.provider,
        providerModelId: entry.providerModelId,
        active: true,
        visible: true,
        supportsStreaming: true,
        contextWindowTokens: entry.contextWindowTokens,
        maxOutputTokens: entry.maxOutputTokens,
      },
      create: {
        slug: entry.slug,
        displayName: entry.displayName,
        vendor: entry.vendor,
        provider: entry.provider,
        providerModelId: entry.providerModelId,
        active: true,
        visible: true,
        supportsStreaming: true,
        contextWindowTokens: entry.contextWindowTokens,
        maxOutputTokens: entry.maxOutputTokens,
      },
    });

    const current = await prisma.aiModelPriceVersion.findFirst({
      where: {
        modelId: model.id,
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });

    const pricesMatch =
      current !== null &&
      current.inputMicroRubPerMillion === entry.inputMicroRubPerMillion &&
      current.outputMicroRubPerMillion === entry.outputMicroRubPerMillion &&
      current.cacheReadMicroRubPerMillion === entry.cacheReadMicroRubPerMillion &&
      current.cacheWriteMicroRubPerMillion === entry.cacheWriteMicroRubPerMillion;

    if (pricesMatch) {
      continue;
    }

    if (current) {
      await prisma.aiModelPriceVersion.update({
        where: { id: current.id },
        data: { effectiveTo: now },
      });
    }

    await prisma.aiModelPriceVersion.create({
      data: {
        modelId: model.id,
        inputMicroRubPerMillion: entry.inputMicroRubPerMillion,
        outputMicroRubPerMillion: entry.outputMicroRubPerMillion,
        cacheReadMicroRubPerMillion: entry.cacheReadMicroRubPerMillion,
        cacheWriteMicroRubPerMillion: entry.cacheWriteMicroRubPerMillion,
        effectiveFrom: entry.verifiedAt,
        effectiveTo: null,
        verifiedAt: entry.verifiedAt,
        source: entry.source,
      },
    });
  }
}
