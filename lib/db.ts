import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

declare global {
  // Un seul client par processus, y compris quand Next.js recharge les modules en dev.
  var studioPrisma: PrismaClient | undefined;
}

export function getDb(): PrismaClient {
  if (!globalThis.studioPrisma) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL manquant : copie .env.example dans .env.local.");
    // `npx prisma dev` (Postgres embarqué) ne supporte qu'une connexion à la fois : DATABASE_POOL_MAX=1.
    const max = Number(process.env.DATABASE_POOL_MAX ?? "");
    globalThis.studioPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString, ...(Number.isInteger(max) && max > 0 ? { max } : {}) }),
    });
  }
  return globalThis.studioPrisma;
}
