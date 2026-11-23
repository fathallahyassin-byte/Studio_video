/** L'agent ne peut pas être appelé (configuration, variable manquante…) : aucun appel LLM n'a eu lieu. */
export class AgentPreconditionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentPreconditionError";
  }
}

/**
 * Entrée de la tâche invalide (payload refusé par Zod) : elle ne deviendra jamais valide.
 * Le worker termine la tâche en échec et alerte l'humain au lieu de la réessayer.
 */
export class AgentInputError extends AgentPreconditionError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentInputError";
  }
}
