export function buildTrustedPasswordResetUrl(webOrigin: string, token: string): string {
  if (token.length === 0 || token.includes("/") || token.includes("\\") || token.includes("://")) {
    throw new Error("Invalid password reset token");
  }

  const origin = new URL(webOrigin);
  const resetUrl = new URL("/reset-password", origin.origin);
  resetUrl.searchParams.set("token", token);
  if (resetUrl.origin !== origin.origin) {
    throw new Error("Password reset URL origin mismatch");
  }

  return resetUrl.toString();
}
