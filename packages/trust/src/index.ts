export {
  TRUST_ERROR_CODES,
  TrustError,
  isTrustError,
  type TrustErrorCode,
} from "./errors.js";
export {
  PrismaUserTrustPolicy,
  lockTrustUserPair,
  type TrustPolicyDb,
  type UserTrustPolicy,
} from "./policy.js";
export {
  TrustService,
  type SurfaceAccessPolicy,
} from "./service.js";
