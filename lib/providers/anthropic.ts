import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageStreamParams, BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { LlmConfigurationError, LlmProviderError, type LlmProvider, type LlmRequest, type LlmResponse } from "./llm";

// Fournisseur LLM : Claude, par le SDK officiel (docs/decisions.md). Le modèle vient de la base (un par agent).

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AnthropicProviderOptions = {
  /** profondeur de réflexion ; la pensée adaptative est toujours active sur les modèles récents */
  effort: Effort;
  maxTokens: number;
  /** taux de conversion du dollar vers la monnaie des budgets (.env) */
  usdRate: number;
  /** envoi de la requête ; remplacé dans les tests */
  send?: (params: BetaMessageStreamParams) => Promise<BetaMessage>;
};

/** Secours automatique côté serveur quand un modèle décline une requête (refus de sécurité). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type Pricing = { input: number; output: number; cacheRead: number };

/**
 * Tarifs en dollars par million de tokens (tarifs publics Anthropic relevés en novembre 2026).
 * L'écriture en cache coûte 1,25 × l'entrée. Un modèle absent est compté au tarif le plus cher,
 * pour ne jamais sous-estimer le budget.
 */
const PRICES: Record<string, Pricing> = {
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
const MOST_EXPENSIVE: Pricing = { input: 10, output: 50, cacheRead: 1 };

type TokenCounts = { model: string | null; input_tokens: number; output_tokens: number; cache_read_input_tokens: number | null; cache_creation_input_tokens: number | null };

function priceOf(counts: TokenCounts): number {
  const pricing = (counts.model ? PRICES[counts.model] : undefined) ?? MOST_EXPENSIVE;
  const perToken = (dollarsPerMillion: number) => dollarsPerMillion / 1_000_000;
  return (
    counts.input_tokens * perToken(pricing.input) +
    counts.output_tokens * perToken(pricing.output) +
    (counts.cache_read_input_tokens ?? 0) * perToken(pricing.cacheRead) +
    (counts.cache_creation_input_tokens ?? 0) * perToken(pricing.input * 1.25)
  );
}

/** Coût en dollars. Quand le secours a servi, chaque modèle est compté à son propre tarif. */
export function estimateCostUsd(model: string, usage: BetaUsage): number {
  const iterations = (usage.iterations ?? []).flatMap((iteration) =>
    iteration.type === "message" || iteration.type === "fallback_message" ? [{ ...iteration, model: iteration.model ?? model }] : [],
  );
  if (iterations.length > 0) return iterations.reduce((total, iteration) => total + priceOf(iteration), 0);
  return priceOf({ ...usage, model });
}

export function buildParams(request: LlmRequest, options: Pick<AnthropicProviderOptions, "effort" | "maxTokens">): BetaMessageStreamParams {
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? options.maxTokens,
    system: request.system,
    messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
    output_config: { effort: options.effort },
    // Le prompt système (prompt de l'agent + bible) est identique d'une relance à l'autre : il passe en cache.
    cache_control: { type: "ephemeral" },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
  };
}

export function toLlmResponse(message: BetaMessage, usdRate: number): LlmResponse {
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category ?? "non précisée";
    throw new LlmProviderError(`Le modèle a refusé la requête (catégorie : ${category}).`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new LlmProviderError("Réponse coupée : limite de tokens de sortie atteinte.");
  }
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  return {
    text,
    inputTokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
    outputTokens: message.usage.output_tokens,
    cost: estimateCostUsd(message.model, message.usage) * usdRate,
  };
}

/** Erreurs du SDK : configuration à corriger (non facturée) ou panne passagère. */
export function mapError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new LlmConfigurationError("Clé Anthropic absente ou refusée : vérifie ANTHROPIC_API_KEY.", { cause: error });
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new LlmConfigurationError("Modèle inconnu : vérifie le modèle de l'agent dans sa page.", { cause: error });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new LlmConfigurationError(`Requête refusée par l'API : ${error.message}`, { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) return new LlmProviderError("Limite de débit Anthropic atteinte.", { cause: error });
  if (error instanceof Anthropic.APIConnectionError) return new LlmProviderError("Anthropic injoignable (réseau ou délai).", { cause: error });
  if (error instanceof Anthropic.APIError) return new LlmProviderError(`Erreur Anthropic ${error.status ?? ""} : ${error.message}`, { cause: error });
  if (error instanceof Anthropic.AnthropicError) {
    // Erreur levée avant l'envoi, typiquement aucune clé trouvée.
    return new LlmConfigurationError(`Client Anthropic non configuré : ${error.message}`, { cause: error });
  }
  return new LlmProviderError(error instanceof Error ? error.message : String(error), { cause: error });
}

export function createAnthropicProvider(options: AnthropicProviderOptions): LlmProvider {
  let client: Anthropic | null = null;
  const send =
    options.send ??
    ((params: BetaMessageStreamParams) => {
      // Créé à la première requête : la clé (ANTHROPIC_API_KEY ou profil `ant auth login`) est lue par le SDK.
      client ??= new Anthropic();
      return client.beta.messages.stream(params).finalMessage();
    });
  return {
    name: "anthropic",
    async complete(request) {
      let message: BetaMessage;
      try {
        message = await send(buildParams(request, options));
      } catch (error) {
        throw mapError(error);
      }
      return toLlmResponse(message, options.usdRate);
    },
  };
}
