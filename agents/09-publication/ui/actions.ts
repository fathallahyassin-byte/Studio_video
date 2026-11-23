"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { readPublicationLabels } from "@/agents/08-controle-qualite/labels";
import { requireOwner } from "@/lib/auth/owner";
import { getDb } from "@/lib/db";
import { toInputJson } from "@/lib/json";
import { ownerActor } from "@/lib/pipeline/deps";
import { applyPlatformEdit, platformEditSchema } from "../edits";
import { PUBLICATION_AGENT_ID } from "../ports";
import { markPublishedManually } from "../publishing";
import { createPrismaPublishingPorts } from "../publishingPorts";
import { MAX_KEYWORDS_LENGTH, withKeywords } from "../settings";
import { parseTexts } from "./overview";

export type PublicationFormState = { ok: boolean; message: string } | null;

const PAGE_PATH = "/agents/09-publication";

const keywordsSchema = z.object({ motsCles: z.string().max(MAX_KEYWORDS_LENGTH) });

/** Mots-clés de la niche ({{MOTS_CLES}}), gardés dans Agent.settings. */
export async function saveKeywordsAction(_previous: PublicationFormState, formData: FormData): Promise<PublicationFormState> {
  await requireOwner();
  const parsed = keywordsSchema.safeParse({ motsCles: formData.get("motsCles") ?? "" });
  if (!parsed.success) return { ok: false, message: `La liste dépasse ${MAX_KEYWORDS_LENGTH} caractères.` };
  const db = getDb();
  const agent = await db.agent.findUnique({ where: { id: PUBLICATION_AGENT_ID }, select: { settings: true } });
  if (!agent) return { ok: false, message: "Agent absent de la base : lance npm run db:seed." };
  await db.agent.update({ where: { id: PUBLICATION_AGENT_ID }, data: { settings: toInputJson(withKeywords(agent.settings, parsed.data.motsCles, new Date())) } });
  revalidatePath(PAGE_PATH);
  return { ok: true, message: "Mots-clés enregistrés pour les prochaines publications." };
}

/**
 * Textes d'une plateforme modifiés à la main. Les étiquettes ne viennent jamais du formulaire :
 * elles sont recopiées du rapport qualité. Seule une publication encore programmée se modifie.
 */
export async function savePlatformTextsAction(_previous: PublicationFormState, formData: FormData): Promise<PublicationFormState> {
  await requireOwner();
  const parsed = platformEditSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Formulaire incomplet ou trop long." };
  const edit = parsed.data;
  const db = getDb();
  const video = await db.video.findUnique({
    where: { id: edit.videoId },
    select: { publishJson: true, qaJson: true, publications: { where: { platform: edit.platform }, select: { id: true, status: true } } },
  });
  const texts = parseTexts(video?.publishJson);
  const labels = readPublicationLabels(video?.qaJson);
  const publication = video?.publications[0];
  if (!texts) return { ok: false, message: "Textes de publication introuvables pour cette vidéo." };
  if (!labels) return { ok: false, message: "Rapport qualité illisible : étiquettes IA inconnues, modification refusée." };
  if (publication?.status !== "SCHEDULED") return { ok: false, message: "Cette publication n'est plus programmée : ses textes ne se modifient plus." };

  const result = applyPlatformEdit(texts, edit, labels);
  if (!result.ok) return { ok: false, message: result.issues.join(" ") };
  await db.$transaction([
    db.video.update({ where: { id: edit.videoId }, data: { publishJson: toInputJson(result.texts) } }),
    db.publication.updateMany({ where: { id: publication.id, status: "SCHEDULED" }, data: { scheduledFor: result.scheduledFor, ...labels[edit.platform] } }),
  ]);
  revalidatePath(PAGE_PATH);
  return { ok: true, message: "Textes et créneau enregistrés." };
}

const markSchema = z.object({
  publicationId: z.string().trim().min(1).max(64),
  lien: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(500)]),
});

/** « Marquer comme publié » (mode manuel) : refusé sans V3 approuvée ; la vidéo passe en PUBLISHED via lib/pipeline. */
export async function markPublishedAction(_previous: PublicationFormState, formData: FormData): Promise<PublicationFormState> {
  await requireOwner();
  const parsed = markSchema.safeParse({ publicationId: formData.get("publicationId"), lien: String(formData.get("lien") ?? "").trim() });
  if (!parsed.success) return { ok: false, message: "Lien invalide : colle l'adresse http(s) de la publication, ou laisse le champ vide." };
  const result = await markPublishedManually(createPrismaPublishingPorts(), {
    publicationId: parsed.data.publicationId,
    link: parsed.data.lien === "" ? null : parsed.data.lien,
    actor: ownerActor(),
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
