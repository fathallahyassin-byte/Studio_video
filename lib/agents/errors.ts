/** L'agent ne peut pas être appelé (configuration, variable manquante…) : aucun appel LLM n'a eu lieu. */
export class AgentPreconditionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentPreconditionError";
  }
}
