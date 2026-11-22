"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizePromptFile } from "@/lib/agents/promptSync";
import { listTemplateVariables } from "@/lib/agents/template";
import { requireOwner } from "@/lib/auth/owner";
import { getDb } from "@/lib/db";

export type FormState = { ok: boolean; message: string } | null;

const promptFormSchema = z.object({
  baseVersionId: z.string(),
  model: z.string().trim().max(200),
  notes: z.string().trim().max(500),
  prompt: z.string().trim().min(1).max(200_000),
});

/** Enregistre le modèle et, si le texte a changé, une nouvelle PromptVersion qui passe en production. */
export async function savePrompt(slug: string, _previous: FormState, formData: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = promptFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Le prompt ne peut pas être vide." };
  const { baseVersionId, model, notes } = parsed.data;
  const prompt = normalizePromptFile(parsed.data.prompt);

  const db = getDb();
  const agent = await db.agent.findUnique({ where: { slug }, include: { activePromptVersion: true } });
  if (!agent) return { ok: false, message: "Agent introuvable." };
  const active = agent.activePromptVersion;
  if ((active?.id ?? "") !== baseVersionId) {
    return { ok: false, message: "Une autre version a été mise en production entre-temps : recharge la page avant d'enregistrer." };
  }

  const unknown = listTemplateVariables(prompt).filter((name) => !listTemplateVariables(active?.content ?? "").includes(name));
  if (active && unknown.length > 0) {
    return { ok: false, message: `Variables inconnues de cet agent : ${unknown.map((name) => `{{${name}}}`).join(", ")}. Son code ne sait pas les remplir.` };
  }

  const changes: string[] = [];
  await db.$transaction(async (tx) => {
    if (model !== agent.model) {
      await tx.agent.update({ where: { id: agent.id }, data: { model } });
      changes.push(model === "" ? "modèle retiré" : `modèle « ${model} »`);
    }
    if (prompt !== active?.content) {
      const last = await tx.promptVersion.aggregate({ where: { agentId: agent.id }, _max: { version: true } });
      const version = (last._max.version ?? 0) + 1;
      const created = await tx.promptVersion.create({
        data: { agentId: agent.id, version, content: prompt, source: "UI", notes: notes === "" ? null : notes },
      });
      await tx.agent.update({ where: { id: agent.id }, data: { activePromptVersionId: created.id } });
      changes.push(`prompt v${version} en production`);
    }
  });

  if (changes.length === 0) return { ok: true, message: "Rien n'a changé." };
  revalidatePath("/agents", "layout");
  return { ok: true, message: `Enregistré : ${changes.join(", ")}.` };
}

/** Remet une version existante en production (retour arrière), sans créer de version. */
export async function activatePromptVersion(slug: string, versionId: string): Promise<void> {
  await requireOwner();
  const db = getDb();
  const version = await db.promptVersion.findFirst({ where: { id: versionId, agent: { slug } }, select: { id: true, agentId: true } });
  if (!version) return;
  await db.agent.update({ where: { id: version.agentId }, data: { activePromptVersionId: version.id } });
  revalidatePath("/agents", "layout");
}
