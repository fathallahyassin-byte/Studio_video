import { getAgentMeta } from "@/agents/_shared/catalog";
import type { AgentDefinition, AgentJobInput } from "@/agents/_shared/types";
import { recordDraft } from "./draft";
import { readStrategyPayload } from "./payload";
import { createPrismaStrategyPorts, type StrategyPorts } from "./ports";
import { checkStrategy } from "./rules";
import { outputSchema } from "./schema";
import { normalizeStrategy } from "./scoring";
import { buildStrategyVariables } from "./variables";

// Agent 1 — Stratège de niche : note les niches, en recommande une et rédige sa bible.
// Lancé à la main depuis sa page, sans vidéo, souvent sans bible active (ctx.bible = null).

const meta = getAgentMeta(1);

export type StrategyDefinition = AgentDefinition<AgentJobInput, typeof outputSchema>;

export function createStrategyDefinition(getPorts: () => StrategyPorts): StrategyDefinition {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,
    async buildVariables(input) {
      const payload = readStrategyPayload(input.payload);
      return buildStrategyVariables(payload, await getPorts().readBibleTemplate());
    },
    normalize(output) {
      return normalizeStrategy(output);
    },
    async controls(output, input) {
      return checkStrategy(output, { payload: readStrategyPayload(input.payload), bibleTemplate: await getPorts().readBibleTemplate() });
    },
    async onSuccess(output, input) {
      await recordDraft(getPorts(), { channelId: input.channelId, jobId: input.jobId, output });
    },
  };
}

export const definition: StrategyDefinition = createStrategyDefinition(createPrismaStrategyPorts);
