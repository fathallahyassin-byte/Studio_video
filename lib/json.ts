import type { Prisma } from "@/lib/generated/prisma/client";

/** Convertit une valeur en JSON stockable par Prisma (dates en texte, undefined retirés). */
export function toInputJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Valeur impossible à enregistrer en JSON.");
  const parsed: Prisma.InputJsonValue = JSON.parse(serialized);
  return parsed;
}
