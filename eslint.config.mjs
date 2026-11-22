import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  globalIgnores([".claude/**", ".next/**", ".next-e2e/**", "out/**", "build/**", "coverage/**", "lib/generated/**", "next-env.d.ts"]),
]);
