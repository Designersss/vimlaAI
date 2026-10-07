export const ADMIN_PERMISSIONS = [
  "finance.read",
  "finance.manage",
  "tariffs.read",
  "tariffs.manage",
  "users.read",
  "ai.read",
  "ai.manage",
  "security.audit.read",
  "admin.manage",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const OWNER_ROLE_CODE = "OWNER";

export const OWNER_PERMISSIONS: readonly AdminPermission[] = ADMIN_PERMISSIONS;

export function isAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

export function hasPermission(
  granted: readonly string[],
  required: AdminPermission,
): boolean {
  return granted.includes(required);
}

export const ADMIN_COOKIE_NAME = "vimla_admin_session";

export const SENSITIVE_ADMIN_ACTIONS = [
  "PLAN_PUBLISHED",
  "PLAN_RETIRED",
  "TOPUP_POLICY_PUBLISHED",
  "PAYMENT_FEE_POLICY_CHANGED",
  "FISCAL_POLICY_CHANGED",
  "TAX_RESERVE_POLICY_CHANGED",
  "BUSINESS_GUARDRAIL_CHANGED",
  "AI_KILL_SWITCH_CHANGED",
  "PAYMENT_RECONCILIATION_ACTION",
  "REFUND_ACTION",
  "ADMIN_PERMISSIONS_CHANGED",
] as const;
