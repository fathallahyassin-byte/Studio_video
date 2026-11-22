"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/owner";
import { getCurrentChannel } from "@/lib/dashboard/queries";
import { getPipelineDeps, ownerActor } from "@/lib/pipeline/deps";
import { createManualVideo, requestScout } from "@/lib/pipeline/service";

export type ProductionFormState = { ok: boolean; message: string } | null;

const videoSchema = z.object({
  title: z.string().trim().min(3).max(200),
  angle: z.string().trim().min(3).max(500),
  revelation: z.string().trim().max(500).optional().default(""),
});

/** « Nouvelle vidéo » : ton idée, validée d'office en V1, part directement chez le recherchiste. */
export async function createVideoAction(_previous: ProductionFormState, formData: FormData): Promise<ProductionFormState> {
  await requireOwner();
  const parsed = videoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Donne un titre et un angle (3 caractères minimum)." };
  const deps = getPipelineDeps();
  const channel = await getCurrentChannel(deps.db);
  if (!channel) return { ok: false, message: "Aucune chaîne en base." };
  await createManualVideo(deps, { channelId: channel.id, ...parsed.data, actor: ownerActor() });
  revalidatePath("/", "layout");
  redirect("/production?fait=video");
}

/** « Lancer la veille de la semaine » : une tâche pour le veilleur, au plus une par semaine. */
export async function launchScoutAction(): Promise<ProductionFormState> {
  await requireOwner();
  const deps = getPipelineDeps();
  const channel = await getCurrentChannel(deps.db);
  if (!channel) return { ok: false, message: "Aucune chaîne en base." };
  const { queued, week } = await requestScout(deps, channel.id, new Date());
  revalidatePath("/", "layout");
  return queued
    ? { ok: true, message: `Veille de la semaine ${week} mise en file : les idées arriveront dans « À valider ».` }
    : { ok: true, message: `La veille de la semaine ${week} est déjà en file.` };
}
