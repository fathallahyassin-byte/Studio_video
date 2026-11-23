import { checkBible } from "@/lib/bible/bible";
import { DRAFT_AUTHOR, type AdoptionPorts } from "./ports";

// « Adopter cette bible » : le brouillon devient la bible active. Aucune BibleVersion n'est
// modifiée ni créée ici : seul le pointeur Channel.activeBibleVersionId change.

export type AdoptionResult = { ok: boolean; message: string; changed: boolean };

const refuse = (message: string): AdoptionResult => ({ ok: false, message, changed: false });

export async function adoptDraft(ports: AdoptionPorts, input: { channelId: string; versionId: string }): Promise<AdoptionResult> {
  const version = await ports.loadBibleVersion(input.versionId);
  if (!version || version.channelId !== input.channelId) return refuse("Brouillon introuvable pour cette chaîne : recharge la page.");
  if (version.author !== DRAFT_AUTHOR) return refuse("Cette version n'a pas été proposée par le stratège : remets-la en service depuis l'écran Bible.");

  const check = checkBible(version.content);
  if (!check.ok) return refuse(`Bible inutilisable par les agents : ${check.error}`);
  if (check.placeholders.length > 0) return refuse(`Champs du modèle encore à remplir : ${check.placeholders.map((name) => `{{${name}}}`).join(", ")}.`);

  if ((await ports.loadActiveBibleId(input.channelId)) === version.id) {
    return { ok: true, message: `La bible v${version.version} est déjà active.`, changed: false };
  }
  await ports.activateBible({ channelId: input.channelId, versionId: version.id });
  return { ok: true, message: `Bible v${version.version} adoptée : les agents l'utiliseront dès la prochaine tâche.`, changed: true };
}
