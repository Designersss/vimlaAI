import { applyDecorators, SetMetadata } from "@nestjs/common";
import type { AdminPermission } from "@vimla/admin";

export const ADMIN_PERMISSION_KEY = "admin_permission";
export const ADMIN_STEP_UP_KEY = "admin_step_up";

export function RequireAdminPermission(
  permission: AdminPermission,
  options?: { stepUp?: boolean },
) {
  return applyDecorators(
    SetMetadata(ADMIN_PERMISSION_KEY, permission),
    SetMetadata(ADMIN_STEP_UP_KEY, options?.stepUp === true),
  );
}
