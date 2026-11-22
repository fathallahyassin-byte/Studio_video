"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/owner";
import { applyBibleFields, checkBible, splitLines } from "@/lib/bible/bible";
import { createActiveBibleVersion } from "@/lib/bible/store";
import { getCurrentChannel } from "@/lib/dashboard/queries";
import { getDb } from "@/lib/db";

export type BibleFormState = { ok: boolean; message: string } | null;

const fieldsSchema = z.object({
  niche: z.string().trim().min(1),
  promesse: z.string().trim().min(1),
  ton: z.string().trim().min(1),
  dureeMin: z.coerce.number().int().positive(),
  dureeMax: z.coerce.number().int().positive(),
  debitVoix: z.coerce.number().positive().max(10),
  voix: z.string().trim().min(1),
  cta: z.string().trim(),
  piliers: z.string(),
  sujetsInterdits: z.string(),
  note: z.string().trim().max(500),
});

const yamlSchema = z.object({ content: z.string().min(1), note: z.string().trim().max(500) });

function refresh(): void {
  revalidatePath("/", "layout");
}

/** Charge la bible active en vérifiant qu'elle n'a pas changé depuis l'ouverture du formulaire. */
async function loadBase(baseVersionId: string) {
  const db = getDb();
  const channel = await getCurrentChannel(db);
  if (!channel) return { error: "Aucune chaîne en base." } as const;
  const active = channel.activeBibleVersionId ? await db.bibleVersion.findUnique({ where: { id: channel.activeBibleVersionId } }) : null;
  if (!active || active.id !== baseVersionId) {
    return { error: "La bible a changé entre-temps (nouvelle version enregistrée ailleurs) : recharge la page." } as const;
  }
  return { db, channel, active } as const;
}

async function saveContent(baseVersionId: string, content: string, note: string): Promise<BibleFormState> {
  const base = await loadBase(baseVersionId);
  if ("error" in base) return { ok: false, message: base.error ?? "Erreur" };
  const check = checkBible(content);
  if (!check.ok) return { ok: false, message: check.error };
  if (content === base.active.content) return { ok: true, message: "Rien n'a changé." };
  const { version } = await createActiveBibleVersion(base.db, { channelId: base.channel.id, content, author: "HUMAN", note: note === "" ? null : note });
  refresh();
  // Recharge la page : les deux formulaires (champs et YAML) repartent de la nouvelle version.
  redirect(`/bible?enregistree=${version}`);
}

export async function saveBibleFields(baseVersionId: string, _previous: BibleFormState, formData: FormData): Promise<BibleFormState> {
  await requireOwner();
  const parsed = fieldsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Remplis la niche, la promesse, le ton, la voix, des durées en secondes et un débit de voix (mots par seconde)." };
  const fields = parsed.data;
  if (fields.dureeMin > fields.dureeMax) return { ok: false, message: "La durée minimale dépasse la durée maximale." };

  const base = await loadBase(baseVersionId);
  if ("error" in base) return { ok: false, message: base.error ?? "Erreur" };
  const content = applyBibleFields(base.active.content, {
    ...fields,
    piliers: splitLines(fields.piliers),
    sujetsInterdits: splitLines(fields.sujetsInterdits),
  });
  return saveContent(baseVersionId, content, fields.note);
}

export async function saveBibleYaml(baseVersionId: string, _previous: BibleFormState, formData: FormData): Promise<BibleFormState> {
  await requireOwner();
  const parsed = yamlSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Le texte de la bible est vide." };
  return saveContent(baseVersionId, parsed.data.content.replace(/\r\n/g, "\n"), parsed.data.note);
}

/** Première bible, à partir de docs/bible.template.yaml (l'agent 1 en proposera une plus tard). */
export async function createBibleFromTemplate(): Promise<void> {
  await requireOwner();
  const db = getDb();
  const channel = await getCurrentChannel(db);
  if (!channel || channel.activeBibleVersionId) return;
  const template = await readFile(path.join(process.cwd(), "docs", "bible.template.yaml"), "utf8");
  await createActiveBibleVersion(db, { channelId: channel.id, content: template.replace(/\r\n/g, "\n"), author: "HUMAN", note: "Créée depuis le modèle" });
  refresh();
}

/** Remet une version existante en service (retour arrière ou adoption d'un brouillon). */
export async function activateBibleVersion(versionId: string): Promise<void> {
  await requireOwner();
  const db = getDb();
  const channel = await getCurrentChannel(db);
  if (!channel) return;
  const version = await db.bibleVersion.findFirst({ where: { id: versionId, channelId: channel.id } });
  if (!version) return;
  const check = checkBible(version.content);
  await db.channel.update({
    where: { id: channel.id },
    data: { activeBibleVersionId: version.id, ...(check.ok ? { niche: check.fields.niche } : {}) },
  });
  refresh();
}
