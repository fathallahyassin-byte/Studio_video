import { defineConfig } from "@playwright/test";
import { E2E_BASE_URL, E2E_PORT, e2eOwner } from "./e2e/fixtures";

// Parcours V1 → V2 → V3 (CLAUDE.md §9). Lancement : E2E_DATABASE_URL="…" npm run test:e2e
// Navigateur : Edge installé sur la machine (PW_CHANNEL=chrome pour Chrome, vide pour le Chromium de Playwright).
const channel = process.env.PW_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  // Le serveur de dev compile chaque page à sa première visite : délais larges.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
    ...(channel ? { channel } : {}),
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      AUTH_SECRET: e2eOwner.authSecret,
      OWNER_EMAIL: e2eOwner.email,
      OWNER_PASSWORD_HASH: e2eOwner.passwordHash,
      OWNER_TOTP_SECRET: e2eOwner.totpSecret,
      NOTIFY_CHANNEL: "console",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
