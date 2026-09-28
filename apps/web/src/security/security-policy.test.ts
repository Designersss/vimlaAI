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
    const scriptPolicy = policy
      .split("; ")
      .find((directive) =>
        directive.startsWith("script-src "),
      );
    expect(scriptPolicy).toBeTruthy();
    expect(scriptPolicy).not.toContain("'unsafe-eval'");
    expect(scriptPolicy).not.toContain("'unsafe-inline'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain(
      "style-src-attr 'unsafe-inline'",
    );
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

  it("does not contain unreviewed executable HTML sinks in browser source", async () => {
    const roots = [
      {
        path: resolve(process.cwd(), "src"),
        label: "apps/web/src",
      },
      {
        path: resolve(
          process.cwd(),
          "../../packages/ui/src",
        ),
        label: "packages/ui/src",
      },
    ];
    const forbidden = [
      /dangerouslySetInnerHTML/,
      /\.innerHTML\s*=/,
      /insertAdjacentHTML\s*\(/,
      /document\.write\s*\(/,
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
    ];
    const reviewedDangerousHtmlSink =
      "packages/ui/src/theme/ThemeScript.tsx";
    const violations: string[] = [];

    async function scan(
      directory: string,
      root: string,
      label: string,
    ): Promise<void> {
      for (const entry of await readdir(directory)) {
        const path = resolve(directory, entry);
        const info = await stat(path);
        if (info.isDirectory()) {
          await scan(path, root, label);
          continue;
        }
        if (!/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry)) {
          continue;
        }
        if (path.endsWith("security-policy.test.ts")) {
          continue;
        }
        const source = await readFile(path, "utf8");
        const relativePath =
          `${label}/${path.slice(root.length + 1)}`;
        for (const pattern of forbidden) {
          if (
            pattern.source ===
              /dangerouslySetInnerHTML/.source &&
            relativePath === reviewedDangerousHtmlSink
          ) {
            const sinkCount = (
              source.match(/dangerouslySetInnerHTML/g) ?? []
            ).length;
            if (
              sinkCount === 1 &&
              source.includes(
                "__html: APPEARANCE_BOOTSTRAP_SCRIPT",
              ) &&
              source.includes("nonce={nonce}")
            ) {
              continue;
            }
          }
          if (pattern.test(source)) {
            violations.push(
              `${relativePath}: ${pattern.source}`,
            );
          }
        }
      }
    }

    for (const root of roots) {
      await scan(root.path, root.path, root.label);
    }
    expect(violations).toEqual([]);
  });
});
