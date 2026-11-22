import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageStreamParams, BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it, vi } from "vitest";
import { buildParams, createAnthropicProvider, estimateCostUsd, mapError, toLlmResponse } from "./anthropic";
import { LlmConfigurationError, LlmProviderError } from "./llm";
import { getConfiguredLlmProvider } from "./llmConfig";

function usage(overrides: Partial<BetaUsage> = {}): BetaUsage {
  return {
    cache_creation: null,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    fallback_credit: null,
    inference_geo: null,
    input_tokens: 0,
    iterations: null,
    output_tokens: 0,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    speed: null,
    ...overrides,
  };
}

function message(overrides: Partial<BetaMessage> = {}): BetaMessage {
  return {
    id: "msg_test",
    container: null,
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: '{"titre":', citations: null },
      { type: "text", text: ' "ok"}', citations: null },
    ],
    context_management: null,
    diagnostics: null,
    model: "claude-opus-5-5",
    role: "assistant",
    stop_details: null,
    stop_reason: "end_turn",
    stop_sequence: null,
    type: "message",
    usage: usage({ input_tokens: 1000, output_tokens: 500 }),
    ...overrides,
  };
}

const request = { model: "claude-opus-5-5", system: "PROMPT + BIBLE", messages: [{ role: "user" as const, content: "Réponds en JSON." }] };

describe("requête envoyée à Claude", () => {
  it("passe le modèle de l'agent, le prompt en système, l'effort, le cache et le secours en cas de refus", () => {
    expect(buildParams(request, { effort: "high", maxTokens: 64_000 })).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 64_000,
      system: "PROMPT + BIBLE",
      messages: [{ role: "user", content: "Réponds en JSON." }],
      output_config: { effort: "high" },
      cache_control: { type: "ephemeral" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  });

  it("n'ajoute ni pensée désactivée ni préremplissage : le dernier message reste celui de l'utilisateur", () => {
    const params = buildParams({ ...request, messages: [...request.messages, { role: "assistant", content: "x" }, { role: "user", content: "corrige" }] }, { effort: "high", maxTokens: 1000 });
    expect(params.thinking).toBeUndefined();
    expect(params.messages.at(-1)?.role).toBe("user");
  });
});

describe("réponse et coût", () => {
  it("ne garde que le texte, compte tous les tokens d'entrée et convertit le coût", () => {
    const response = toLlmResponse(
      message({ usage: usage({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 400 }) }),
      0.9,
    );
    expect(response.text).toBe('{"titre": "ok"}');
    expect(response).toMatchObject({ inputTokens: 3400, outputTokens: 500 });
    // 1000 × 4 $ + 500 × 20 $ + 2000 × 0,20 $ + 400 × 5 $ (écriture en cache) par million, × 0,9
    expect(response.cost).toBeCloseTo(0.0164 * 0.9, 8);
  });

  it("compte chaque modèle à son tarif quand le secours a servi", () => {
    const iterations: BetaUsage["iterations"] = [
      { type: "message", model: "claude-opus-5-5", input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
      { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
    ];
    expect(estimateCostUsd("claude-opus-4-8", usage({ iterations }))).toBeCloseTo(4 + 5, 6);
  });

  it("compte un modèle inconnu au tarif le plus cher", () => {
    expect(estimateCostUsd("claude-inconnu", usage({ input_tokens: 1_000_000 }))).toBeCloseTo(10, 6);
  });

  it("signale un refus ou une réponse coupée", () => {
    expect(() => toLlmResponse(message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null, fallback_credit_token: null, fallback_has_prefill_claim: null, recommended_model: null } }), 1)).toThrow(/catégorie : cyber/);
    expect(() => toLlmResponse(message({ stop_reason: "max_tokens" }), 1)).toThrow(LlmProviderError);
  });
});

describe("erreurs de l'API", () => {
  const apiError = (status: number) => Anthropic.APIError.generate(status, undefined, "erreur", new Headers());

  it("distingue la configuration à corriger d'une panne passagère", () => {
    expect(mapError(apiError(401))).toBeInstanceOf(LlmConfigurationError);
    expect(mapError(apiError(404))).toBeInstanceOf(LlmConfigurationError);
    expect(mapError(apiError(400))).toBeInstanceOf(LlmConfigurationError);
    for (const status of [429, 500, 529]) {
      const mapped = mapError(apiError(status));
      expect(mapped).toBeInstanceOf(LlmProviderError);
      expect(mapped).not.toBeInstanceOf(LlmConfigurationError);
    }
  });

  it("transmet l'erreur du SDK par le provider", async () => {
    const send = vi.fn<(params: BetaMessageStreamParams) => Promise<BetaMessage>>(async () => {
      throw apiError(401);
    });
    const provider = createAnthropicProvider({ effort: "high", maxTokens: 1000, usdRate: 1, send });
    await expect(provider.complete(request)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("renvoie la réponse convertie quand tout va bien", async () => {
    const provider = createAnthropicProvider({ effort: "medium", maxTokens: 1000, usdRate: 1, send: async () => message() });
    await expect(provider.complete(request)).resolves.toMatchObject({ text: '{"titre": "ok"}', outputTokens: 500 });
  });
});

describe("choix du fournisseur", () => {
  it("active Claude par LLM_PROVIDER ou par la présence d'une clé, et le désactive sinon", () => {
    expect(getConfiguredLlmProvider({ LLM_PROVIDER: "anthropic" })?.name).toBe("anthropic");
    expect(getConfiguredLlmProvider({ ANTHROPIC_API_KEY: "sk-test" })?.name).toBe("anthropic");
    expect(getConfiguredLlmProvider({ LLM_PROVIDER: "aucun", ANTHROPIC_API_KEY: "sk-test" })).toBeNull();
    expect(getConfiguredLlmProvider({})).toBeNull();
  });
});
