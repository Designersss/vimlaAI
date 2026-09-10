export const AUTH_BASE_PATH = "/api/auth";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
}

export interface AuthSessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified?: boolean;
}

export function toAuthenticatedUser(user: AuthSessionUser): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image ?? null,
    emailVerified: user.emailVerified === true,
  };
}

export function containsForbiddenAuthFields(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object") {
    return false;
  }

  const keys = Object.keys(payload);
  return keys.some((key) => {
    const normalized = key.toLowerCase();
    return (
      normalized === "password" ||
      normalized === "passwordhash" ||
      normalized === "sessiontoken" ||
      normalized === "otp" ||
      normalized === "token" ||
      normalized === "currentpassword" ||
      normalized === "newpassword"
    );
  });
}
