"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/owner";
import { getCurrentChannel } from "@/lib/dashboard/queries";
import { getDb } from "@/lib/db";
import { adoptDraft } from "../adoption";
import { launchStrategy } from "../launch";
import { parseStrategyForm } from "../payload";
import { createPrismaAdoptionPorts, createPrismaLaunchPorts, PAGE_PATH } from "../ports";

export type StrategyFormState = { ok: boolean; message: string } | null;

const NO_CHANNEL: StrategyFormState = { ok: false, message: "Aucune chaîne en base." };

/** « Lancer l'analyse » : une tâche de l'agent 1 en file, avec le formulaire validé en payload. */
export async function launchStrategyAction(_previous: StrategyFormState, formData: FormData): Promise<StrategyFormState> {
  await requireOwner();
  const parsed = parseStrategyForm(Object.fromEntries(formData));
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const db = getDb();
  const channel = await getCurrentChannel(db);
  if (!channel) return NO_CHANNEL;
  const result = await launchStrategy(createPrismaLaunchPorts(db), { channelId: channel.id, payload: parsed.payload, now: new Date() });
  if (result.ok) revalidatePath(PAGE_PATH);
  return result;
}

const adoptSchema = z.object({ versionId: z.string().trim().min(1).max(64) });

/** « Adopter cette bible » : le brouillon devient la bible active, sans modifier aucune version. */
export async function adoptBibleAction(_previous: StrategyFormState, formData: FormData): Promise<StrategyFormState> {
  await requireOwner();
  const parsed = adoptSchema.safeParse({ versionId: formData.get("versionId") });
  if (!parsed.success) return { ok: false, message: "Brouillon inconnu : recharge la page." };
  const db = getDb();
  const channel = await getCurrentChannel(db);
  if (!channel) return NO_CHANNEL;
  const result = await adoptDraft(createPrismaAdoptionPorts(db), { channelId: channel.id, versionId: parsed.data.versionId });
  // La bible active change pour tout l'outil (écran Bible, agents, menu).
  if (result.changed) revalidatePath("/", "layout");
  return { ok: result.ok, message: result.message };
}
