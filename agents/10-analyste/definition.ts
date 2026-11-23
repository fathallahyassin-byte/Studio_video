import { getAgentMeta } from "@/agents/_shared/catalog";
import type { AgentDefinition, AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { readNicheCriterion } from "./bibleText";
import { createPrismaAnalysisPorts, type AnalysisPorts } from "./ports";
import { checkReport, normalizeReport } from "./rules";
import { outputSchema, type Output } from "./schema";
import { analysisPeriod, buildSnapshot, hasComparableVideos, type AnalysisSnapshot } from "./snapshot";
import { MIN_AGE_HOURS, referenceTime, WINDOW_DAYS, windowStart } from "./stats";
import { formatCriterion, formatExperiments, formatMetadata, formatStats } from "./variables";

// Agent 10 — Analyste : travaille sur une chaîne (videoId null), une fois par semaine.
// Médianes, écarts, exclusion des vidéos de moins de 72 h et regroupements sont calculés en code (snapshot.ts) ;
// le modèle interprète, et ses chiffres sont contrôlés contre ceux du code.

const meta = getAgentMeta(10);

export type AnalystDefinition = AgentDefinition<AgentJobInput, typeof outputSchema>;

/** Aucune vidéo comparable : le modèle n'est pas appelé (il inventerait des chiffres). */
export class NotEnoughDataError extends AgentPreconditionError {
  constructor() {
    super(
      `Pas encore de statistiques à analyser : aucune vidéo publiée depuis plus de ${MIN_AGE_HOURS} h avec un relevé sur les ${WINDOW_DAYS} derniers jours. Le modèle n'a pas été appelé.`,
    );
    this.name = "NotEnoughDataError";
  }
}

export function createAnalystDefinition(getPorts: () => AnalysisPorts): AnalystDefinition {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,
    async buildVariables(input, ctx) {
      const ports = getPorts();
      const snapshot = await loadSnapshot(ports, input.channelId);
      if (!hasComparableVideos(snapshot)) throw new NotEnoughDataError();
      return {
        STATS: formatStats(snapshot),
        METADONNEES: formatMetadata(snapshot.metas),
        EXPERIENCES: formatExperiments(await ports.loadRunningExperiments(input.channelId)),
        CRITERE_NICHE: formatCriterion(readNicheCriterion(ctx.bible)),
      };
    },
    normalize(output) {
      return normalizeReport(output, { period: analysisPeriod(referenceTime(getPorts().now())) });
    },
    async controls(output, input) {
      const ports = getPorts();
      const [snapshot, running] = await Promise.all([loadSnapshot(ports, input.channelId), ports.loadRunningExperiments(input.channelId)]);
      return checkReport(output, snapshot, running);
    },
    async onSuccess(output, input) {
      await recordReport(getPorts(), input, output);
    },
  };
}

/** Relu à chaque étape (variables, normalize, controls) à la même heure pleine : aucun état gardé entre deux appels. */
export async function loadSnapshot(ports: AnalysisPorts, channelId: string): Promise<AnalysisSnapshot> {
  const now = referenceTime(ports.now());
  const period = await ports.loadPeriod(channelId, windowStart(now), now);
  return buildSnapshot({ now, ...period });
}

/**
 * Enregistre le rapport (unique par AgentRun) et ses expériences proposées. Idempotent : rejoué après un crash,
 * il trouve le rapport déjà écrit et n'ajoute rien.
 */
export async function recordReport(ports: AnalysisPorts, input: AgentJobInput, output: Output): Promise<"created" | "exists"> {
  const agentRunId = await ports.findSucceededRunId(input.jobId);
  if (!agentRunId) throw new Error(`Exécution réussie de l'analyste introuvable pour la tâche ${input.jobId}.`);
  return ports.saveReport({ channelId: input.channelId, agentRunId, period: output.periode, content: output });
}

export const definition: AnalystDefinition = createAnalystDefinition(createPrismaAnalysisPorts);
