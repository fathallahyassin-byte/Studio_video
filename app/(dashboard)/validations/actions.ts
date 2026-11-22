"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/owner";
import { getPipelineDeps, ownerActor } from "@/lib/pipeline/deps";
import { V3_RETURN_STAGES } from "@/lib/pipeline/machine";
import { applyEvent, decideIdeas, resumeVideo, TransitionError } from "@/lib/pipeline/service";
import { parseSourceLines } from "@/lib/videos/sources";
import type { DoneCode } from "./messages";

export type DecisionState = { ok: boolean; message: string } | null;

const note = z.string().trim().max(2000).optional().default("");

function finish(code: DoneCode): never {
  revalidatePath("/", "layout");
  redirect(`/validations?fait=${code}`);
}

async function guard(run: () => Promise<DoneCode>): Promise<DecisionState> {
  await requireOwner();
  let code: DoneCode;
  try {
    code = await run();
  } catch (error) {
    if (error instanceof TransitionError) return { ok: false, message: error.message };
    throw error;
  }
  finish(code);
}

const ideasSchema = z.object({ intent: z.enum(["approve", "reject"]), note });

/** V1 : produire ou écarter les idées cochées. */
export async function decideIdeasAction(_previous: DecisionState, formData: FormData): Promise<DecisionState> {
  const parsed = ideasSchema.safeParse({ intent: formData.get("intent"), note: formData.get("note") ?? undefined });
  const videoIds = formData.getAll("ideas").filter((value): value is string => typeof value === "string");
  if (!parsed.success) return { ok: false, message: "Choisis « Valider la sélection » ou « Écarter la sélection »." };
  if (videoIds.length === 0) return { ok: false, message: "Coche au moins une idée." };
  return guard(async () => {
    const approve = parsed.data.intent === "approve";
    await decideIdeas(getPipelineDeps(), { videoIds, approve, note: parsed.data.note || null, actor: ownerActor() });
    return approve ? "v1-approved" : "v1-rejected";
  });
}

const videoSchema = z.object({
  intent: z.enum(["approve", "changes"]),
  note,
  returnTo: z.enum(V3_RETURN_STAGES).optional(),
});

/** V2 ou V3 : valider, ou renvoyer à un agent avec une note. */
export async function decideVideoAction(videoId: string, gate: "V2" | "V3", _previous: DecisionState, formData: FormData): Promise<DecisionState> {
  const parsed = videoSchema.safeParse({ intent: formData.get("intent"), note: formData.get("note") ?? undefined, returnTo: formData.get("returnTo") ?? undefined });
  if (!parsed.success) return { ok: false, message: "Décision illisible : recharge la page." };
  const { intent } = parsed.data;
  if (intent === "changes" && parsed.data.note === "") return { ok: false, message: "Écris dans la note ce que l'agent doit corriger." };
  return guard(async () => {
    const event = gate === "V2" ? (intent === "approve" ? "V2_APPROVED" : "V2_CHANGES_REQUESTED") : intent === "approve" ? "V3_APPROVED" : "V3_CHANGES_REQUESTED";
    await applyEvent(getPipelineDeps(), { videoId, event, actor: ownerActor(), note: parsed.data.note || null, returnTo: parsed.data.returnTo });
    if (gate === "V2") return intent === "approve" ? "v2-approved" : "v2-changes";
    return intent === "approve" ? "v3-approved" : "v3-changes";
  });
}

const fixSchema = z.object({ intent: z.enum(["resume", "abandon"]), note });

/**
 * Vidéo à corriger : relancer l'étape bloquée, ou abandonner la vidéo.
 * Pour une vidéo bloquée en recherche, les sources saisies sont enregistrées avant la relance.
 */
export async function resolveFixAction(videoId: string, _previous: DecisionState, formData: FormData): Promise<DecisionState> {
  const parsed = fixSchema.safeParse({ intent: formData.get("intent"), note: formData.get("note") ?? undefined });
  if (!parsed.success) return { ok: false, message: "Choisis « Relancer l'étape » ou « Abandonner la vidéo »." };
  const resume = parsed.data.intent === "resume";
  const rawSources = formData.get("sources");
  const sources = resume && typeof rawSources === "string" ? parseSourceLines(rawSources) : null;
  if (sources && !sources.ok) return { ok: false, message: sources.error };
  return guard(async () => {
    const deps = getPipelineDeps();
    const note = parsed.data.note || null;
    if (!resume) {
      await applyEvent(deps, { videoId, event: "ABANDONED", actor: ownerActor(), note });
      return "abandoned";
    }
    await resumeVideo(deps, { videoId, actor: ownerActor(), note, researchSources: sources?.ok ? sources.urls : undefined });
    return "resumed";
  });
}
