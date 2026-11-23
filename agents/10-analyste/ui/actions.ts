"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/owner";
import { getCurrentChannel } from "@/lib/dashboard/queries";
import { getDb } from "@/lib/db";
import { applyReportToBible, closeExperiment, launchAnalysis, launchExperiment, type ActionResult } from "../actionsLogic";
import { createPrismaHumanPorts } from "../humanPorts";
import { isUniqueViolation } from "../ports";

// Server Actions de /agents/10-analyste : toutes vérifient la session puis valident le formulaire avec Zod.

export type AnalystFormState = ActionResult | null;

const PAGE_PATH = "/agents/10-analyste";

const idSchema = z.string().trim().min(1).max(64);
const applySchema = z.object({ reportId: idSchema, lines: z.array(z.coerce.number().int().min(0).max(20)).max(20) });
const experimentSchema = z.object({ experimentId: idSchema });

async function currentChannelId(): Promise<string | null> {
  const channel = await getCurrentChannel(getDb());
  return channel?.id ?? null;
}

function refresh(result: ActionResult): ActionResult {
  if (result.ok) {
    revalidatePath(PAGE_PATH);
    revalidatePath("/bible");
  }
  return result;
}

export async function applyToBibleAction(_previous: AnalystFormState, formData: FormData): Promise<AnalystFormState> {
  await requireOwner();
  const parsed = applySchema.safeParse({ reportId: formData.get("reportId"), lines: formData.getAll("lines") });
  if (!parsed.success) return { ok: false, message: "Sélection invalide : recharge la page." };
  const channelId = await currentChannelId();
  if (!channelId) return { ok: false, message: "Aucune chaîne en base." };
  try {
    return refresh(await applyReportToBible(createPrismaHumanPorts(getDb()), { reportId: parsed.data.reportId, channelId, selected: parsed.data.lines }));
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: "La bible vient d'être enregistrée ailleurs : réessaie." };
    throw error;
  }
}

export async function launchExperimentAction(_previous: AnalystFormState, formData: FormData): Promise<AnalystFormState> {
  return changeExperiment(formData, launchExperiment);
}

export async function closeExperimentAction(_previous: AnalystFormState, formData: FormData): Promise<AnalystFormState> {
  return changeExperiment(formData, closeExperiment);
}

async function changeExperiment(formData: FormData, change: typeof launchExperiment): Promise<AnalystFormState> {
  await requireOwner();
  const parsed = experimentSchema.safeParse({ experimentId: formData.get("experimentId") });
  if (!parsed.success) return { ok: false, message: "Expérience inconnue." };
  const channelId = await currentChannelId();
  if (!channelId) return { ok: false, message: "Aucune chaîne en base." };
  return refresh(await change(createPrismaHumanPorts(getDb()), { experimentId: parsed.data.experimentId, channelId, now: new Date() }));
}

export async function launchAnalysisAction(): Promise<AnalystFormState> {
  await requireOwner();
  const channelId = await currentChannelId();
  if (!channelId) return { ok: false, message: "Aucune chaîne en base." };
  return refresh(await launchAnalysis(createPrismaHumanPorts(getDb()), { channelId, now: new Date() }));
}
