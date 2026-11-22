import type { z } from "zod";
import type { AgentMeta } from "./catalog";
import type { AgentDefinition } from "./types";

export class AgentNotImplementedError extends Error {
  constructor(agentName: string) {
    super(`Agent à implémenter : ${agentName}`);
    this.name = "AgentNotImplementedError";
  }
}

/** Définition provisoire : refuse toute exécution tant que le fork de l'agent ne l'a pas remplacée. */
export function createPlaceholderDefinition<TSchema extends z.ZodType>(
  meta: AgentMeta,
  outputSchema: TSchema,
): AgentDefinition<unknown, TSchema> {
  return {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    promptFile: "prompt.md",
    outputSchema,
    async buildVariables() {
      throw new AgentNotImplementedError(meta.name);
    },
    async onSuccess() {
      throw new AgentNotImplementedError(meta.name);
    },
  };
}
