import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

// Charge .env.local puis .env, comme Next.js.
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Vide quand on se contente de `prisma generate` : seules les commandes qui touchent la base en ont besoin.
    url: process.env.DATABASE_URL ?? "",
  },
});
