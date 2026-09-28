import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  webSecurityHeaders,
} from "./security-policy";

describe("web security policy", () => {
  it("builds a production CSP without unsafe script execution fallbacks", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "nonce-value",
      apiBaseUrl: "https://api.vimla.example",
      development: false,
    });

    expect(policy).toContain(
      "script-src 'self' 'nonce-nonce-value' 'strict-dynamic'",
    );
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain(
      "connect-src 'self' https://api.vimla.example wss://api.vimla.example",
    );
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("allows the Next development evaluator only in development", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "dev-nonce",
      apiBaseUrl: "http://localhost:3101",
      development: true,
    });

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("http://localhost:3101");
    expect(policy).toContain("ws://localhost:3101");
    expect(policy).toContain("ws:");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("emits hardened production response headers", () => {
    const headers = new Map(
      webSecurityHeaders({ production: true }),
    );

    expect(headers.get("X-Content-Type-Options")).toBe(
      "nosniff",
    );
    expect(headers.get("Referrer-Policy")).toBe(
      "no-referrer",
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Permissions-Policy")).toContain(
      "camera=()",
    );
    expect(
      headers.get("Strict-Transport-Security"),
    ).toContain("max-age=63072000");
  });

  it("does not contain unreviewed executable HTML sinks in web source", async () => {
    const sourceRoot = resolve(process.cwd(), "src");
    const forbidden = [
      /dangerouslySetInnerHTML/,
      /\.innerHTML\s*=/,
      /insertAdjacentHTML\s*\(/,
      /document\.write\s*\(/,
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
    ];
    const violations: string[] = [];

    async function scan(directory: string): Promise<void> {
      for (const entry of await readdir(directory)) {
        const path = resolve(directory, entry);
        const info = await stat(path);
        if (info.isDirectory()) {
          await scan(path);
          continue;
        }
        if (!/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry)) {
          continue;
        }
        if (path.endsWith("security-policy.test.ts")) {
          continue;
        }
        const source = await readFile(path, "utf8");
        for (const pattern of forbidden) {
          if (pattern.test(source)) {
            violations.push(
              `${path.slice(sourceRoot.length + 1)}: ${pattern.source}`,
            );
          }
        }
      }
    }

    await scan(sourceRoot);
    expect(violations).toEqual([]);
  });
});
