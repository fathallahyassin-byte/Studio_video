import { z } from "zod";
import type { Platform } from "@/lib/generated/prisma/client";
import { textsFor } from "./platforms";
import { applyLabels, hardLimitIssues } from "./rules";
import type { Output } from "./schema";
import { parseSlot } from "./slots";
import { parseHashtagInput } from "./text";
import type { Labels } from "./variables";

// Textes modifiés par l'humain sur la page de l'agent. Le formulaire n'a aucun champ d'étiquette :
// les étiquettes sont toujours recopiées du rapport qualité, même si la requête en contient.

const text = (max: number) => z.string().trim().max(max);
const common = { videoId: z.string().trim().min(1).max(64), hashtags: text(1000), creneau: z.string().trim() };

export const platformEditSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("TIKTOK"), ...common, legende: text(4000), texte_couverture: text(200), commentaire_epingle: text(500) }),
  z.object({ platform: z.literal("INSTAGRAM"), ...common, legende: text(4000), texte_couverture: text(200) }),
  z.object({ platform: z.literal("YOUTUBE"), ...common, titre: text(200), description: text(6000), commentaire_epingle: text(500) }),
]);

export type PlatformEdit = z.infer<typeof platformEditSchema>;

export type EditResult = { ok: true; texts: Output; scheduledFor: Date } | { ok: false; issues: string[] };

function withEdit(texts: Output, edit: PlatformEdit): Output {
  const hashtags = parseHashtagInput(edit.hashtags);
  switch (edit.platform) {
    case "TIKTOK":
      return { ...texts, tiktok: { ...texts.tiktok, legende: edit.legende, hashtags, texte_couverture: edit.texte_couverture, commentaire_epingle: edit.commentaire_epingle, creneau: edit.creneau } };
    case "INSTAGRAM":
      return { ...texts, instagram: { ...texts.instagram, legende: edit.legende, hashtags, texte_couverture: edit.texte_couverture, creneau: edit.creneau } };
    case "YOUTUBE":
      return { ...texts, youtube: { ...texts.youtube, titre: edit.titre, description: edit.description, hashtags, commentaire_epingle: edit.commentaire_epingle, creneau: edit.creneau } };
  }
}

/** Applique la modification si les plateformes l'accepteraient ; les règles éditoriales du prompt ne s'imposent pas à l'humain. */
export function applyPlatformEdit(texts: Output, edit: PlatformEdit, labels: Labels): EditResult {
  const scheduledFor = parseSlot(edit.creneau);
  const edited = applyLabels(withEdit(texts, edit), labels);
  const issues = hardLimitIssues(edit.platform, textsFor(edited, edit.platform));
  if (!scheduledFor) issues.push("Créneau invalide : choisis une date et une heure.");
  return scheduledFor && issues.length === 0 ? { ok: true, texts: edited, scheduledFor } : { ok: false, issues };
}

export function readPlatform(value: FormDataEntryValue | null): Platform | null {
  return value === "TIKTOK" || value === "INSTAGRAM" || value === "YOUTUBE" ? value : null;
}
