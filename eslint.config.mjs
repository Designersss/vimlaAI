import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.next-e2e/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/generated/**",
      "apps/web/.next/**",
      "apps/web/.next-e2e/**",
      "apps/admin/.next/**",
      "apps/admin/.next-e2e/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mjs"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: "module",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-extraneous-class": [
        "error",
        { allowWithDecorator: true },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/cli.ts"],
    rules: {
      "no-console": "off",
    },
  },
);
