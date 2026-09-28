const CSP_DIRECTIVES_SEPARATOR = "; ";

export interface WebSecurityPolicyInput {
  nonce: string;
  apiBaseUrl: string;
  development: boolean;
}

export interface WebSecurityHeaderOptions {
  production: boolean;
}

function websocketOrigin(url: URL): string {
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}`;
}

export function buildContentSecurityPolicy(
  input: WebSecurityPolicyInput,
): string {
  const apiUrl = new URL(input.apiBaseUrl);
  if (apiUrl.protocol !== "http:" && apiUrl.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must use http or https");
  }

  const connectSources = new Set<string>([
    "'self'",
    apiUrl.origin,
    websocketOrigin(apiUrl),
  ]);
  if (input.development) {
    // Next dev uses a websocket for HMR. This is intentionally development-only.
    connectSources.add("ws:");
  }

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic'${
      input.development ? " 'unsafe-eval'" : ""
    }`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${input.nonce}'`,
    `style-src-elem 'self' 'nonce-${input.nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src ${[...connectSources].join(" ")}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!input.development) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join(CSP_DIRECTIVES_SEPARATOR);
}

export function webSecurityHeaders(
  options: WebSecurityHeaderOptions,
): ReadonlyArray<readonly [string, string]> {
  const headers: Array<readonly [string, string]> = [
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["X-Frame-Options", "DENY"],
    [
      "Permissions-Policy",
      [
        "accelerometer=()",
        "camera=()",
        "geolocation=()",
        "gyroscope=()",
        "magnetometer=()",
        "microphone=()",
        "payment=()",
        "usb=()",
        "browsing-topics=()",
      ].join(", "),
    ],
  ];
  if (options.production) {
    headers.push([
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    ]);
  }
  return headers;
}
