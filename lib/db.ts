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
    globalThis.studioPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }
  return globalThis.studioPrisma;
}
