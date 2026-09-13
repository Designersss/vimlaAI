export interface SecurityHeaderOptions {
  appEnv: string | undefined;
  apiOrigin?: string;
}

export interface WebSecurityHeader {
  key: string;
  value: string;
}

/**
 * Static Next.js CSP. Next emits inline bootstrap scripts and styles, so a nonce-only
 * policy requires request-scoped rendering/middleware. Keep the residual
 * `unsafe-inline` exception explicit while still forbidding eval and framing.
 */
export function createWebSecurityHeaders(options: SecurityHeaderOptions): WebSecurityHeader[] {
  const productionLike = options.appEnv === "staging" || options.appEnv === "production";
  const connectSources = ["'self'"];
  if (options.apiOrigin) {
    const parsed = new URL(options.apiOrigin);
    connectSources.push(parsed.origin);
  }
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${productionLike ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "media-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(productionLike ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers: WebSecurityHeader[] = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=(), publickey-credentials-get=(self)",
    },
  ];
  if (productionLike) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
  }
  return headers;
}
