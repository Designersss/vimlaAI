import { SetMetadata } from "@nestjs/common";

export const SENSITIVE_AREA_KEY = "vimlaSensitiveArea";
export const SENSITIVE_MUTATION_KEY = "vimlaSensitiveMutation";
export const ALLOW_UNVERIFIED_KEY = "vimlaAllowUnverified";

export const SensitiveArea = (): ClassDecorator => SetMetadata(SENSITIVE_AREA_KEY, true);

export const SensitiveMutation = (): MethodDecorator =>
  SetMetadata(SENSITIVE_MUTATION_KEY, true);

export const AllowUnverified = (): MethodDecorator => SetMetadata(ALLOW_UNVERIFIED_KEY, true);
