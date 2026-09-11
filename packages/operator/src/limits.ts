export const OPERATOR_RUNTIME_LIMITS = {
  maxToolsPerRun: 8,
  snapshotItems: 20,
  publicMessageMax: 2_000,
  clarificationMax: 500,
  confirmationTtlSeconds: 900,
} as const;

export const PLANNER_MARKER = "VIMLA_OPERATOR_PLANNER_V1";
