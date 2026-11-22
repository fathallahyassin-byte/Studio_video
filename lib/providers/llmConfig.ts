import { createAnthropicProvider, type Effort } from "./anthropic";
import type { LlmProvider } from "./llm";

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

function parseEffort(value: string | undefined): Effort {
  return EFFORTS.find((effort) => effort === value) ?? "high";
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Fournisseur LLM du worker, d'après .env. Anthropic dès que LLM_PROVIDER="anthropic"
 * (ou qu'une ANTHROPIC_API_KEY est présente et LLM_PROVIDER vide). null = les tâches d'agents restent en file.
 */
export function getConfiguredLlmProvider(env: Record<string, string | undefined> = process.env): LlmProvider | null {
  const choice = env.LLM_PROVIDER?.trim() || (env.ANTHROPIC_API_KEY ? "anthropic" : "");
  if (choice !== "anthropic") return null;
  return createAnthropicProvider({
    effort: parseEffort(env.LLM_EFFORT),
    maxTokens: positiveNumber(env.LLM_MAX_TOKENS, 64_000),
    usdRate: positiveNumber(env.USD_EXCHANGE_RATE, 1),
  });
}
