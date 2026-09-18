import {
  estimateReservationMicroRub,
  type PriceVersionQuote,
} from "@vimla/ai";

export type AiExecutionBudgetProfileName = "SHORT" | "STANDARD" | "LONG";

export type AiExecutionBudgetProfile = {
  preferredOutputTokens: number;
  minimumOutputTokens: number;
};

export type AiExecutionBudgetProfiles = Record<
  AiExecutionBudgetProfileName,
  AiExecutionBudgetProfile
>;

export type FundedAiExecutionBudget = {
  profile: AiExecutionBudgetProfileName;
  preferredOutputTokens: number;
  minimumOutputTokens: number;
  selectedOutputTokens: number;
  estimatedCostMicroRub: bigint;
};

export type AiExecutionBudgetResult =
  | { kind: "FUNDED"; budget: FundedAiExecutionBudget }
  | { kind: "INSUFFICIENT_USAGE" };

export function resolveAiExecutionBudget(input: {
  profile: AiExecutionBudgetProfileName;
  profiles: AiExecutionBudgetProfiles;
  modelMaxOutputTokens: number;
  estimatedInputTokens: number;
  availableMicroRub: bigint;
  maxReservationMicroRub: bigint;
  price: PriceVersionQuote;
  safetyBps: bigint;
}): AiExecutionBudgetResult {
  assertPositiveInteger(input.modelMaxOutputTokens, "modelMaxOutputTokens");
  assertNonNegativeInteger(input.estimatedInputTokens, "estimatedInputTokens");

  if (input.availableMicroRub <= 0n || input.maxReservationMicroRub <= 0n) {
    return { kind: "INSUFFICIENT_USAGE" };
  }

  const configured = input.profiles[input.profile];
  validateProfile(input.profile, configured);

  const preferredOutputTokens = Math.min(
    configured.preferredOutputTokens,
    input.modelMaxOutputTokens,
  );
  const minimumOutputTokens = Math.min(
    configured.minimumOutputTokens,
    preferredOutputTokens,
  );
  const spendCeiling =
    input.availableMicroRub < input.maxReservationMicroRub
      ? input.availableMicroRub
      : input.maxReservationMicroRub;

  const minimumCost = reservationCost({
    estimatedInputTokens: input.estimatedInputTokens,
    maxOutputTokens: minimumOutputTokens,
    price: input.price,
    safetyBps: input.safetyBps,
  });
  if (minimumCost > spendCeiling) {
    return { kind: "INSUFFICIENT_USAGE" };
  }

  const preferredCost = reservationCost({
    estimatedInputTokens: input.estimatedInputTokens,
    maxOutputTokens: preferredOutputTokens,
    price: input.price,
    safetyBps: input.safetyBps,
  });
  if (preferredCost <= spendCeiling) {
    return {
      kind: "FUNDED",
      budget: {
        profile: input.profile,
        preferredOutputTokens,
        minimumOutputTokens,
        selectedOutputTokens: preferredOutputTokens,
        estimatedCostMicroRub: preferredCost,
      },
    };
  }

  let low = minimumOutputTokens;
  let high = preferredOutputTokens;
  let selectedOutputTokens = minimumOutputTokens;
  let selectedCost = minimumCost;

  while (low <= high) {
    const candidate = low + Math.floor((high - low) / 2);
    const candidateCost = reservationCost({
      estimatedInputTokens: input.estimatedInputTokens,
      maxOutputTokens: candidate,
      price: input.price,
      safetyBps: input.safetyBps,
    });

    if (candidateCost <= spendCeiling) {
      selectedOutputTokens = candidate;
      selectedCost = candidateCost;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }

  return {
    kind: "FUNDED",
    budget: {
      profile: input.profile,
      preferredOutputTokens,
      minimumOutputTokens,
      selectedOutputTokens,
      estimatedCostMicroRub: selectedCost,
    },
  };
}

export function validateAiExecutionBudgetProfiles(
  profiles: AiExecutionBudgetProfiles,
): void {
  for (const profile of ["SHORT", "STANDARD", "LONG"] as const) {
    validateProfile(profile, profiles[profile]);
  }
}

function reservationCost(input: {
  estimatedInputTokens: number;
  maxOutputTokens: number;
  price: PriceVersionQuote;
  safetyBps: bigint;
}): bigint {
  return estimateReservationMicroRub({
    estimatedInputTokens: BigInt(input.estimatedInputTokens),
    maxOutputTokens: BigInt(input.maxOutputTokens),
    price: input.price,
    safetyBps: input.safetyBps,
  });
}

function validateProfile(
  name: AiExecutionBudgetProfileName,
  profile: AiExecutionBudgetProfile,
): void {
  assertPositiveInteger(
    profile.minimumOutputTokens,
    `${name}.minimumOutputTokens`,
  );
  assertPositiveInteger(
    profile.preferredOutputTokens,
    `${name}.preferredOutputTokens`,
  );
  if (profile.minimumOutputTokens > profile.preferredOutputTokens) {
    throw new Error(
      `${name}.minimumOutputTokens must not exceed preferredOutputTokens`,
    );
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}
