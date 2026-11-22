import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    // Les tests d'intégration partagent une base : un fichier à la fois quand elle est fournie.
    fileParallelism: !process.env.TEST_DATABASE_URL,
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", ".claude/**", "e2e/**"],
  },
});
