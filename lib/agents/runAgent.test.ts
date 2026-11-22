import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentDefinition } from "@/agents/_shared/types";
import type { LlmProvider, LlmRequest, LlmResponse } from "@/lib/providers/llm";
import { LlmConfigurationError, LlmProviderError } from "@/lib/providers/llm";
import type { Notifier } from "@/lib/providers/notify";
import { AgentPreconditionError } from "./errors";
import { createMemoryRunStore } from "./memoryStore";
import { FIRST_USER_MESSAGE, runAgent } from "./runAgent";

const schema = z.object({ titre: z.string(), score: z.number() });
type Input = { idee: string };

const PROMPT = "# CONTEXTE\n{{BIBLE}}\n\n# ENTRÉE\nIdée : {{IDEE}}";
const VALID = JSON.stringify({ titre: "Le trombone", score: 4.26 });

function makeDefinition(overrides: Partial<AgentDefinition<Input, typeof schema>> = {}) {
  const onSuccess = vi.fn(async () => {});
  const definition: AgentDefinition<Input, typeof schema> = {
    id: 4,
    slug: "04-scenariste",
    name: "Scénariste",
    promptFile: "prompt.md",
    outputSchema: schema,
    async buildVariables(input) {
      return { IDEE: input.idee };
    },
    normalize(output) {
      return { ...output, score: Math.round(output.score * 10) / 10 };
    },
    controls(output) {
      return [output.score <= 5 ? { ok: true } : { ok: false, reason: "score au-dessus de 5" }];
    },
    onSuccess,
    ...overrides,
  };
  return { definition, onSuccess };
}

type Scripted = string | Error;

function makeLlm(script: Scripted[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: "fake",
    requests,
    async complete(request): Promise<LlmResponse> {
      requests.push(request);
      const next = script.shift();
      if (next === undefined) throw new Error("plus de réponse prévue");
      if (next instanceof Error) throw next;
      return { text: next, inputTokens: 100, outputTokens: 50, cost: 0.01 };
    },
  };
}

function makeNotifier(): Notifier & { sent: Parameters<Notifier["notify"]>[0][] } {
  const sent: Parameters<Notifier["notify"]>[0][] = [];
  return { sent, async notify(notification) { sent.push(notification); } };
}

function setup(script: Scripted[], options: { bible?: string | null; active?: boolean; model?: string } = {}) {
  const store = createMemoryRunStore();
  store.setAgent({
    id: 4,
    slug: "04-scenariste",
    name: "Scénariste",
    model: options.model ?? "modele-test",
    active: options.active ?? true,
    promptVersion: { id: "pv-1", content: PROMPT },
  });
  const bible = options.bible === undefined ? "niche: objets du quotidien" : options.bible;
  if (bible !== null) store.setActiveBible("chaine-1", { id: "bible-3", content: bible });
  const llm = makeLlm(script);
  const notifier = makeNotifier();
  return { store, llm, notifier, deps: { store, llm, notifier } };
}

const request = (definition: AgentDefinition<Input, typeof schema>, jobKey = "video-1:SCRIPT:4") => ({
  definition,
  input: { idee: "Le secret du trombone" },
  channelId: "chaine-1",
  videoId: "video-1",
  jobKey,
});

describe("runAgent", () => {
  it("accepte une sortie valide du premier coup et enregistre l'AgentRun", async () => {
    const { definition, onSuccess } = makeDefinition();
    const { store, llm, deps } = setup([VALID]);

    const result = await runAgent(request(definition), deps);

    expect(result).toMatchObject({ status: "ok", attempt: 1, reused: false, output: { titre: "Le trombone", score: 4.3 } });
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({
      status: "OK",
      attempt: 1,
      promptVersionId: "pv-1",
      bibleVersionId: "bible-3",
      model: "modele-test",
      input: { IDEE: "Le secret du trombone" },
      inputTokens: 100,
      outputTokens: 50,
      cost: 0.01,
    });
    expect(store.runs[0]?.successHandledAt).not.toBeNull();
    expect(store.videoCosts.get("video-1")).toBeCloseTo(0.01);
    expect(llm.requests[0]?.system).toBe("# CONTEXTE\nniche: objets du quotidien\n\n# ENTRÉE\nIdée : Le secret du trombone");
    expect(llm.requests[0]?.messages).toEqual([{ role: "user", content: FIRST_USER_MESSAGE }]);
  });

  it("lit un JSON entouré de texte ou de balises de code", async () => {
    const { definition } = makeDefinition();
    const { deps } = setup([`Voici la sortie :\n\`\`\`json\n${VALID}\n\`\`\``]);

    await expect(runAgent(request(definition), deps)).resolves.toMatchObject({ status: "ok" });
  });

  it("relance avec le message d'erreur quand le JSON est illisible", async () => {
    const { definition } = makeDefinition();
    const { store, llm, deps } = setup(["pas du json", VALID]);

    const result = await runAgent(request(definition), deps);

    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "OK"]);
    const retry = llm.requests[1]?.messages ?? [];
    expect(retry).toHaveLength(3);
    expect(retry[1]).toEqual({ role: "assistant", content: "pas du json" });
    expect(retry[2]?.content).toContain("JSON lisible");
  });

  it("donne au modèle le chemin du champ qui ne respecte pas le schéma", async () => {
    const { definition } = makeDefinition();
    const { store, llm, deps } = setup([JSON.stringify({ titre: "x", score: "quatre" }), VALID]);

    await runAgent(request(definition), deps);

    expect(store.runs[0]?.error).toContain("score");
    expect(llm.requests[1]?.messages[2]?.content).toContain("ne respecte pas le schéma");
  });

  it("compte un contrôle en code refusé comme une tentative", async () => {
    const { definition } = makeDefinition();
    const { store, llm, deps } = setup([JSON.stringify({ titre: "x", score: 9 }), VALID]);

    await runAgent(request(definition), deps);

    expect(store.runs.map((run) => run.status)).toEqual(["CONTROL_FAILED", "OK"]);
    expect(llm.requests[1]?.messages[2]?.content).toContain("score au-dessus de 5");
  });

  it("donne à normalize (éventuellement asynchrone) et à controls le contexte de l'appel", async () => {
    const seen: string[] = [];
    const { definition } = makeDefinition({
      async normalize(output, _input, ctx) {
        seen.push(`normalize:${ctx.bible}:${ctx.bibleVersionId}`);
        return { ...output, titre: output.titre.toUpperCase() };
      },
      controls(output, _input, ctx) {
        seen.push(`controls:${ctx.videoId}`);
        return [output.titre === output.titre.toUpperCase() ? { ok: true } : { ok: false, reason: "normalize non attendu" }];
      },
    });
    const { deps } = setup([VALID]);

    await expect(runAgent(request(definition), deps)).resolves.toMatchObject({ status: "ok", output: { titre: "LE TROMBONE" } });
    expect(seen).toEqual(["normalize:niche: objets du quotidien:bible-3", "controls:video-1"]);
  });

  it("passe la vidéo en NEEDS_FIX et alerte après 3 échecs", async () => {
    const { definition, onSuccess } = makeDefinition();
    const { store, notifier, deps } = setup(["a", "b", "c"]);

    const result = await runAgent(request(definition), deps);

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(store.runs.map((run) => run.attempt)).toEqual([1, 2, 3]);
    expect(store.needsFix.get("video-1")).toContain("Scénariste");
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatchObject({ kind: "agent_failed", path: "/production?video=video-1" });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("n'appelle pas le modèle si une variable n'est pas remplacée", async () => {
    const { definition } = makeDefinition({ async buildVariables() { return {}; } });
    const { store, llm, deps } = setup([VALID]);

    await expect(runAgent(request(definition), deps)).rejects.toThrow(/\{\{IDEE\}\}/);
    expect(llm.requests).toHaveLength(0);
    expect(store.runs).toHaveLength(0);
  });

  it("refuse un prompt qui attend la bible quand aucune n'est adoptée", async () => {
    const { definition } = makeDefinition();
    const { llm, deps } = setup([VALID], { bible: null });

    await expect(runAgent(request(definition), deps)).rejects.toThrow(/Aucune bible/);
    expect(llm.requests).toHaveLength(0);
  });

  it("n'interprète pas les accolades contenues dans la bible injectée", async () => {
    const { definition } = makeDefinition();
    const { llm, deps } = setup([VALID], { bible: 'nom: "{{NOM}}"' });

    await runAgent(request(definition), deps);

    expect(llm.requests[0]?.system).toContain('nom: "{{NOM}}"');
  });

  it("ignore une variable BIBLE fournie par l'agent : la bible vient toujours de la base", async () => {
    const { definition } = makeDefinition({ async buildVariables(input) { return { IDEE: input.idee, BIBLE: "fausse" }; } });
    const { store, llm, deps } = setup([VALID]);

    await runAgent(request(definition), deps);

    expect(llm.requests[0]?.system).toContain("niche: objets du quotidien");
    expect(store.runs[0]?.input).toEqual({ IDEE: "Le secret du trombone" });
  });

  it.each([
    ["désactivé", { active: false }, /désactivé/],
    ["sans modèle", { model: "  " }, /Aucun modèle/],
  ])("n'appelle jamais un agent %s", async (_label, options, message) => {
    const { definition } = makeDefinition();
    const { llm, deps } = setup([VALID], options);

    await expect(runAgent(request(definition), deps)).rejects.toThrow(AgentPreconditionError);
    await expect(runAgent(request(definition), deps)).rejects.toThrow(message);
    expect(llm.requests).toHaveLength(0);
  });

  describe("reprise sans doublon", () => {
    it("ne rappelle ni le modèle ni onSuccess pour une exécution déjà terminée", async () => {
      const { definition, onSuccess } = makeDefinition();
      const { llm, deps } = setup([VALID]);
      await runAgent(request(definition), deps);

      const again = await runAgent(request(definition), deps);

      expect(again).toMatchObject({ status: "ok", reused: true, output: { score: 4.3 } });
      expect(llm.requests).toHaveLength(1);
      expect(onSuccess).toHaveBeenCalledOnce();
    });

    it("rejoue seulement onSuccess s'il avait échoué après un appel réussi", async () => {
      const failingOnce = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("panne base")).mockResolvedValue();
      const { definition } = makeDefinition({ onSuccess: failingOnce });
      const { store, llm, deps } = setup([VALID]);
      await expect(runAgent(request(definition), deps)).rejects.toThrow("panne base");

      const again = await runAgent(request(definition), deps);

      expect(again).toMatchObject({ status: "ok", reused: true });
      expect(llm.requests).toHaveLength(1);
      expect(failingOnce).toHaveBeenCalledTimes(2);
      expect(store.runs[0]?.successHandledAt).not.toBeNull();
    });

    it("reprend à la tentative suivante avec l'échange reconstruit", async () => {
      const { definition } = makeDefinition();
      const first = setup(["pas du json", VALID]);
      await first.store.recordAttempt({
        jobKey: "video-1:SCRIPT:4", attempt: 1, channelId: "chaine-1", videoId: "video-1", agentId: 4,
        promptVersionId: "pv-1", bibleVersionId: "bible-3", model: "modele-test", input: {}, output: null,
        rawOutput: "réponse cassée", status: "INVALID_JSON", error: "JSON illisible",
        inputTokens: 0, outputTokens: 0, cost: 0, durationMs: 0,
      });
      first.llm.requests.length = 0;
      const deps = { ...first.deps, llm: makeLlm([VALID]) };

      const result = await runAgent(request(definition), deps);

      expect(result).toMatchObject({ status: "ok", attempt: 2 });
      expect(deps.llm.requests[0]?.messages[1]).toEqual({ role: "assistant", content: "réponse cassée" });
    });
  });

  describe("erreurs du fournisseur", () => {
    it("enregistre la tentative puis laisse la file réessayer plus tard", async () => {
      const { definition } = makeDefinition();
      const { store, deps } = setup([new LlmProviderError("délai dépassé")]);

      await expect(runAgent(request(definition), deps)).rejects.toThrow("délai dépassé");
      expect(store.runs).toMatchObject([{ attempt: 1, status: "ERROR", error: "délai dépassé" }]);

      const retry = { ...deps, llm: makeLlm([VALID]) };
      await expect(runAgent(request(definition), retry)).resolves.toMatchObject({ status: "ok", attempt: 2 });
      expect(retry.llm.requests[0]?.messages).toEqual([{ role: "user", content: FIRST_USER_MESSAGE }]);
    });

    it("ne compte pas de tentative pour une configuration à corriger (clé, modèle)", async () => {
      const { definition } = makeDefinition();
      const { store, deps } = setup([new LlmConfigurationError("Modèle inconnu")]);

      await expect(runAgent(request(definition), deps)).rejects.toThrow(AgentPreconditionError);
      expect(store.runs).toHaveLength(0);
    });

    it("passe en NEEDS_FIX sans lever d'erreur à la troisième panne", async () => {
      const { definition } = makeDefinition();
      const { store, notifier, deps } = setup(["a", "b", new LlmProviderError("panne")]);

      const result = await runAgent(request(definition), deps);

      expect(result).toMatchObject({ status: "needs_fix", reason: "panne", attempts: 3 });
      expect(store.needsFix.has("video-1")).toBe(true);
      expect(notifier.sent).toHaveLength(1);
    });
  });

  it("alerte vers la page de l'agent quand l'exécution n'a pas de vidéo", async () => {
    const { definition } = makeDefinition();
    const { notifier, deps } = setup(["a", "b", "c"]);

    await runAgent({ ...request(definition, "veille:2026-W47"), videoId: null }, deps);

    expect(notifier.sent[0]?.path).toBe("/agents/04-scenariste");
  });
});
