export const AUTH_BASE_PATH = "/api/auth";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

export interface AuthSessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

export function toAuthenticatedUser(user: AuthSessionUser): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image ?? null,
  };
}

export function containsForbiddenAuthFields(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object") {
    return false;
  }

  const keys = Object.keys(payload);
  return keys.some(
    (key) => key === "password" || key === "passwordHash" || key === "sessionToken",
  );
}
