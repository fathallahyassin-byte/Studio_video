import { execSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { hasData } from "./db";
import { e2eDatabaseUrl } from "./fixtures";

/**
 * Prépare la base jetable de l'e2e : vidée si elle a déjà servi, migrée, puis remplie
 * avec les agents et les données de démo.
 */
export default async function globalSetup(): Promise<void> {
  loadEnvConfig(process.cwd());
  const url = e2eDatabaseUrl();
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL) {
    throw new Error("E2E_DATABASE_URL est la base de l'appli : refusé, l'e2e la viderait. Utilise une base dédiée.");
  }
  const env = { ...process.env, DATABASE_URL: url };
  const prepare = (await hasData(url)) ? "npx prisma migrate reset --force" : "npx prisma migrate deploy";
  for (const command of [prepare, "npx tsx prisma/seed.ts", "npx tsx prisma/seed-demo.ts"]) {
    execSync(command, { env, stdio: "inherit" });
  }
}
