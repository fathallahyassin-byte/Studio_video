import { draftMarker, type DraftRef, type StrategyPorts } from "./ports";
import type { Output } from "./schema";

// Après la sortie : UNE BibleVersion en brouillon par tâche. Elle ne devient active qu'à l'adoption.

const MAX_NICHE_IN_NOTE = 120;

export function draftNote(niche: string, jobId: string): string {
  const shortNiche = niche.trim().slice(0, MAX_NICHE_IN_NOTE);
  return `Proposée par le stratège de niche : « ${shortNiche} » ${draftMarker(jobId)}`;
}

/**
 * Idempotent : rejoué après un crash avec la même sortie, il retrouve le brouillon de la tâche
 * (par la note) au lieu d'en créer un second. N'écrit jamais dans une version existante.
 */
export async function recordDraft(
  ports: StrategyPorts,
  input: { channelId: string; jobId: string; output: Output },
): Promise<{ draft: DraftRef; created: boolean }> {
  const existing = await ports.findDraftForJob(input.channelId, input.jobId);
  if (existing) return { draft: existing, created: false };
  const niche = input.output.recommandation.niche.trim();
  const draft = await ports.createDraft({ channelId: input.channelId, content: normalizeNewlines(input.output.bible), note: draftNote(niche, input.jobId) });
  await ports.notifyDraft({ draft, niche });
  return { draft, created: true };
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}
