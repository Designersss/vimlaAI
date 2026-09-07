import { rubToMicroRub, type MicroRub } from "./money.js";
import type { PlanCode } from "./types.js";

export interface PlanCatalogEntry {
  code: PlanCode;
  name: string;
  priceMicroRub: MicroRub;
  providerBudgetMicroRub: MicroRub;
  providerCostRatioBps: number;
}

export const VIMLA_PLAN_CATALOG: readonly PlanCatalogEntry[] = [
  {
    code: "LITE",
    name: "Lite",
    priceMicroRub: rubToMicroRub(150n),
    providerBudgetMicroRub: rubToMicroRub(30n),
    providerCostRatioBps: 2000,
  },
  {
    code: "START",
    name: "Start",
    priceMicroRub: rubToMicroRub(300n),
    providerBudgetMicroRub: rubToMicroRub(75n),
    providerCostRatioBps: 2500,
  },
  {
    code: "PRO",
    name: "Pro",
    priceMicroRub: rubToMicroRub(990n),
    providerBudgetMicroRub: rubToMicroRub(297n),
    providerCostRatioBps: 3000,
  },
];

export function planCatalogByCode(code: string): PlanCatalogEntry | undefined {
  return VIMLA_PLAN_CATALOG.find((entry) => entry.code === code);
}
