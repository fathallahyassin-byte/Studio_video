import { getAgentMeta } from "@/agents/_shared/catalog";
import type { AgentContext, AgentDefinition, AgentJobInput } from "@/agents/_shared/types";
import { checkBible } from "@/lib/bible/bible";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { isoWeek } from "@/lib/pipeline/service";
import { createPrismaScoutStore } from "./prismaStore";
import { backlogSince, backlogTitles, saveScoutIdeas, type ScoutStore } from "./proposals";
import { normalizeScout, scoutControls, type ScoutContext } from "./rules";
import { outputSchema } from "./schema";
import { formatBacklog, formatLearnings, formatSignals } from "./variables";

export type ScoutDefinition = AgentDefinition<AgentJobInput, typeof outputSchema>;

/** Contextes gardés entre buildVariables et normalize/controls, par tâche ; borné au cas où une tâche s'arrête en route. */
const MAX_KEPT_CONTEXTS = 20;

function biblePillarsAndBans(bible: string | null): Pick<ScoutContext, "pillars" | "sujetsInterdits"> {
  const checked = bible === null ? null : checkBible(bible);
  if (!checked?.ok) return { pillars: [], sujetsInterdits: [] };
  return { pillars: checked.fields.piliers, sujetsInterdits: checked.fields.sujetsInterdits };
}

/**
 * Veilleur. normalize et controls n'ont que la sortie et l'entrée : ce que le code doit savoir
 * (backlog, piliers, signaux…) est lu une fois par buildVariables et gardé pour la tâche en cours.
 */
export function createScoutDefinition(store: ScoutStore, clock: () => Date = () => new Date()): ScoutDefinition {
  const meta = getAgentMeta(2);
  const contexts = new Map<string, ScoutContext>();

  function keep(jobId: string, context: ScoutContext): void {
    contexts.delete(jobId);
    contexts.set(jobId, context);
    const oldest = contexts.keys().next();
    if (contexts.size > MAX_KEPT_CONTEXTS && !oldest.done) contexts.delete(oldest.value);
  }

  function contextFor(jobId: string): ScoutContext {
    const context = contexts.get(jobId);
    if (!context) throw new Error(`Contexte de veille absent pour la tâche ${jobId} : buildVariables n'a pas tourné.`);
    return context;
  }

  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,

    async buildVariables(input: AgentJobInput, ctx: AgentContext) {
      const now = clock();
      const [signals, learnings, recent] = await Promise.all([
        store.loadSignals(),
        store.loadLearnings(input.channelId),
        store.listRecentVideos(input.channelId, backlogSince(now)),
      ]);
      const titles = backlogTitles(recent, input.jobId);
      keep(input.jobId, {
        week: isoWeek(now),
        hasSignals: signals.trim() !== "",
        hasLearnings: learnings.length > 0,
        backlogTitles: titles,
        ...biblePillarsAndBans(ctx.bible),
      });
      return { SIGNAUX: formatSignals(signals), APPRENTISSAGES: formatLearnings(learnings), BACKLOG_EXISTANT: formatBacklog(titles) };
    },

    normalize(output, input) {
      return normalizeScout(output, contextFor(input.jobId));
    },

    controls(output, input) {
      return scoutControls(output, contextFor(input.jobId));
    },

    async onSuccess(output, input) {
      await saveScoutIdeas(store, output, { channelId: input.channelId, jobId: input.jobId }, clock());
      contexts.delete(input.jobId);
    },
  };
}

export const definition: ScoutDefinition = createScoutDefinition(createPrismaScoutStore(getPipelineDeps));
