import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Client Prisma des tests d'intégration (TEST_DATABASE_URL). Respecte DATABASE_POOL_MAX comme l'appli :
 * avec `npx prisma dev`, plusieurs connexions simultanées font échouer les requêtes au hasard.
 */
export function createTestDb(url: string): PrismaClient {
  const max = Number(process.env.DATABASE_POOL_MAX ?? "");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, ...(Number.isInteger(max) && max > 0 ? { max } : {}) }) });
}
