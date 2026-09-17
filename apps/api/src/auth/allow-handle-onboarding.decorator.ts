import { SetMetadata } from "@nestjs/common";

export const ALLOW_HANDLE_ONBOARDING = "vimla:allow-handle-onboarding";

export const AllowHandleOnboarding = () => SetMetadata(ALLOW_HANDLE_ONBOARDING, true);
