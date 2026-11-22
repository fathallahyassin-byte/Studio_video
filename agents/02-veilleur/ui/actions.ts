"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/owner";
import { getCurrentChannel } from "@/lib/dashboard/queries";
import { toInputJson } from "@/lib/json";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { requestScout } from "@/lib/pipeline/service";
import { SCOUT_AGENT_ID } from "../prismaStore";
import { MAX_SIGNALS_LENGTH, withSignals } from "../settings";

export type ScoutFormState = { ok: boolean; message: string } | null;

const PAGE_PATH = "/agents/02-veilleur";

const signalsSchema = z.object({ signaux: z.string().max(MAX_SIGNALS_LENGTH) });

/** « Signaux de la semaine » : gardés dans Agent.settings, d'une semaine à l'autre. */
export async function saveSignalsAction(_previous: ScoutFormState, formData: FormData): Promise<ScoutFormState> {
  await requireOwner();
  const parsed = signalsSchema.safeParse({ signaux: formData.get("signaux") ?? "" });
  if (!parsed.success) return { ok: false, message: `Les signaux dépassent ${MAX_SIGNALS_LENGTH} caractères.` };
  const { db } = getPipelineDeps();
  const agent = await db.agent.findUnique({ where: { id: SCOUT_AGENT_ID }, select: { settings: true } });
  if (!agent) return { ok: false, message: "Agent absent de la base : lance npm run db:seed." };
  const settings = withSignals(agent.settings, parsed.data.signaux, new Date());
  await db.agent.update({ where: { id: SCOUT_AGENT_ID }, data: { settings: toInputJson(settings) } });
  revalidatePath(PAGE_PATH);
  return { ok: true, message: parsed.data.signaux.trim() === "" ? "Signaux vidés : la prochaine veille travaillera en hypothèses." : "Signaux enregistrés pour la prochaine veille." };
}

/** « Lancer la veille » : la même tâche que l'écran Production, au plus une par semaine. */
export async function launchScoutAction(): Promise<ScoutFormState> {
  await requireOwner();
  const deps = getPipelineDeps();
  const channel = await getCurrentChannel(deps.db);
  if (!channel) return { ok: false, message: "Aucune chaîne en base." };
  const { queued, week } = await requestScout(deps, channel.id, new Date());
  revalidatePath("/", "layout");
  return queued
    ? { ok: true, message: `Veille de la semaine ${week} mise en file : les idées arriveront dans « À valider ».` }
    : { ok: true, message: `La veille de la semaine ${week} est déjà en file ou faite.` };
}
