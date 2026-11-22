// Interface du fournisseur LLM. Le fournisseur concret est choisi plus tard (docs/decisions.md) ;
// le modèle se règle par agent, en base.

export type LlmMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LlmRequest = {
  model: string;
  system: string;
  messages: LlmMessage[];
  maxOutputTokens?: number;
};

export type LlmResponse = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** coût de l'appel, dans la monnaie des budgets (.env) */
  cost: number;
};

export type LlmProvider = {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
};

/**
 * Fournisseur LLM utilisé par le worker. Aucun n'est encore choisi (docs/decisions.md) :
 * tant que c'est le cas, le worker laisse les tâches d'agents en file au lieu de les faire échouer.
 */
export function getConfiguredLlmProvider(): LlmProvider | null {
  return null;
}

/** Erreur du fournisseur (réseau, quota, panne) : ce n'est pas la faute du modèle. */
export class LlmProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmProviderError";
  }
}
