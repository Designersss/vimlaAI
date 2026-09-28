import { NextResponse, type NextRequest } from "next/server";
import { publicWebConfig } from "./shared/config/public-env";
import {
  buildContentSecurityPolicy,
  webSecurityHeaders,
} from "./security/security-policy";

function requestNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = requestNonce();
  const development = process.env.NODE_ENV === "development";
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    apiBaseUrl: publicWebConfig.apiBaseUrl,
    development,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(
    "Content-Security-Policy",
    contentSecurityPolicy,
  );

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(
    "Content-Security-Policy",
    contentSecurityPolicy,
  );
  for (const [name, value] of webSecurityHeaders({
    production: !development,
  })) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
