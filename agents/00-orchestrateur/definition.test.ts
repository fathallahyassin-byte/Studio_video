import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createMemoryRunStore } from "@/lib/agents/memoryStore";
import { runAgent } from "@/lib/agents/runAgent";
import type { PipelineEvent } from "@/lib/pipeline/machine";
import { applyEvent, TransitionError, type Actor } from "@/lib/pipeline/service";
import type { LlmProvider, LlmRequest } from "@/lib/providers/llm";
import type { Notification } from "@/lib/providers/notify";
import { createTestDb } from "@/lib/testing/testDb";
import { createOrchestratorDefinition, definition, recordProposal } from "./definition";
import { CHANNEL_ID, makeGateOutput, makeOutput, makePorts, makeProject, TEST_BIBLE, VIDEO_ID } from "./fixtures";
import { BUDGET_MISSING } from "./variables";

const PROMPT = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
const json = (value: unknown) => JSON.stringify(value);

function makeLlm(answers: string[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: "faux",
    requests,
    async complete(request) {
      requests.push(request);
      const text = answers.shift();
      if (text === undefined) throw new Error("plus de réponse prévue");
      return { text, inputTokens: 3000, outputTokens: 400, cost: 0.02 };
    },
  };
}

type SetupOptions = Parameters<typeof makePorts>[0] & { storeActive?: boolean; videoId?: string | null; note?: string | null };

function setup(answers: string[], options: SetupOptions = {}) {
  const fake = makePorts(options);
  const orchestrator = createOrchestratorDefinition(() => fake.ports);
  const store = createMemoryRunStore();
  store.setAgent({ id: 0, slug: "00-orchestrateur", name: "Orchestrateur", model: "modele-test", active: options.storeActive ?? true, promptVersion: { id: "pv-0", content: PROMPT } });
  store.setActiveBible(CHANNEL_ID, { id: "bible-1", content: TEST_BIBLE });
  const llm = makeLlm(answers);
  const sent: Notification[] = [];
  const notifier = { notify: async (notification: Notification) => void sent.push(notification) };
  const videoId = options.videoId === undefined ? VIDEO_ID : options.videoId;
  const input: AgentJobInput = { jobId: "job-1", channelId: CHANNEL_ID, videoId, note: options.note ?? null, payload: null };
  const run = (jobKey = "transition-1:agent-0") => runAgent({ definition: orchestrator, input, channelId: CHANNEL_ID, videoId, jobKey }, { store, llm, notifier });
  return { ...fake, orchestrator, store, llm, sent, input, run };
}

describe("définition exportée", () => {
  it("reprend l'identité du catalogue (agent 0) et le schéma", () => {
    expect(definition).toMatchObject({ id: 0, slug: "00-orchestrateur", name: "Orchestrateur", promptFile: "prompt.md" });
  });
});

describe("orchestrateur avec runAgent (faux LLM, fausse base)", () => {
  it("sortie valide : variables remplies, AgentRun complet, sortie normalisée", async () => {
    const test = setup([json(makeOutput({ etape_actuelle: "Script", prochaine_action: { agent: "04-scenariste", consigne: "Écris le script.", entrees: {} } }))]);
    const result = await test.run();

    expect(result).toMatchObject({ status: "ok", attempt: 1, reused: false });
    expect(test.llm.requests).toHaveLength(1);
    const system = test.llm.requests[0]?.system ?? "";
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(system).toContain(TEST_BIBLE);
    expect(system).toContain('"video_id": "video-1"');
    const [run] = test.store.runs;
    expect(run).toMatchObject({ status: "OK", agentId: 0, promptVersionId: "pv-0", bibleVersionId: "bible-1", inputTokens: 3000, outputTokens: 400, cost: 0.02 });
    expect(Object.keys(run?.input ?? {}).sort()).toEqual(["BUDGET_PAR_VIDEO", "ETAT_PROJET"]);
    expect(run?.output).toMatchObject({ etape_actuelle: "SCRIPT", prochaine_action: { agent: "scenariste" } });
    expect(test.store.needsFix.size).toBe(0);
  });

  it("sortie invalide 3 fois : 2 relances avec l'erreur, puis NEEDS_FIX et alerte", async () => {
    const test = setup(["pas du JSON", json({ video_id: VIDEO_ID }), json({ ...makeOutput(), statut: "termine" })]);
    const result = await test.run();

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(test.llm.requests).toHaveLength(3);
    expect(test.store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "INVALID_JSON", "INVALID_JSON"]);
    expect(test.store.needsFix.get(VIDEO_ID)).toContain("Orchestrateur");
    expect(test.sent).toEqual([expect.objectContaining({ kind: "agent_failed" })]);
  });

  it("contrôle refusé puis corrigé : la raison est renvoyée au modèle", async () => {
    const test = setup([json(makeOutput({ video_id: "autre-video" })), json(makeOutput())]);
    const result = await test.run();

    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(test.store.runs.map((run) => run.status)).toEqual(["CONTROL_FAILED", "OK"]);
    expect(JSON.stringify(test.llm.requests[1]?.messages)).toContain("video_id doit être");
  });

  it("budget absent : texte explicite, l'appel a lieu", async () => {
    const test = setup([json(makeOutput())], { budget: undefined });
    await test.run();
    expect(test.store.runs[0]?.input.BUDGET_PAR_VIDEO).toBe(BUDGET_MISSING);
  });

  it("transmet la note de l'humain dans {{ETAT_PROJET}}", async () => {
    const test = setup([json(makeOutput())], { note: "Vérifie la date du brevet." });
    await test.run();
    expect(test.store.runs[0]?.input.ETAT_PROJET).toContain("Vérifie la date du brevet.");
  });
});

describe("désactivé, jamais appelé", () => {
  it("Agent.active = false en base : runAgent refuse, aucun appel au modèle, aucun AgentRun", async () => {
    const test = setup([json(makeOutput())], { storeActive: false });
    await expect(test.run()).rejects.toBeInstanceOf(AgentPreconditionError);
    expect(test.llm.requests).toHaveLength(0);
    expect(test.store.runs).toHaveLength(0);
  });

  it("désactivé lu par la définition : refus avant toute lecture de la vidéo", async () => {
    const test = setup([json(makeOutput())], { active: false });
    await expect(test.run()).rejects.toThrow("désactivé");
    expect(test.llm.requests).toHaveLength(0);
    expect(test.calls.loadProject).toBe(0);
  });
});

describe("préconditions", () => {
  it("vidéo introuvable : aucun appel", async () => {
    const test = setup([json(makeOutput())], { project: null });
    await expect(test.run()).rejects.toThrow("introuvable");
    expect(test.llm.requests).toHaveLength(0);
  });

  it("tâche sans vidéo : aucun appel", async () => {
    const test = setup([json(makeOutput())], { videoId: null });
    await expect(test.run()).rejects.toBeInstanceOf(AgentPreconditionError);
    expect(test.llm.requests).toHaveLength(0);
  });
});

describe("activé, aucune validation sautée", () => {
  it("à V2, un agent proposé est refusé 3 fois : jamais accepté, l'humain est alerté", async () => {
    const skip = json(makeGateOutput("AWAITING_V2", { prochaine_action: { agent: "directeur_artistique", consigne: "Lance le storyboard.", entrees: {} } }));
    const test = setup([skip, skip, skip], { project: makeProject({ stage: "AWAITING_V2" }) });
    const result = await test.run();

    expect(result).toMatchObject({ status: "needs_fix" });
    expect(test.store.runs.every((run) => run.status === "CONTROL_FAILED")).toBe(true);
    expect(test.store.runs.some((run) => run.output !== null)).toBe(false);
  });

  it("à V3, la proposition « humain + résumé » est acceptée", async () => {
    const test = setup([json(makeGateOutput("AWAITING_V3"))], { project: makeProject({ stage: "AWAITING_V3" }) });
    expect(await test.run()).toMatchObject({ status: "ok" });
  });

  it.each(["V1_APPROVED", "V1_REJECTED", "V2_APPROVED", "V2_CHANGES_REQUESTED", "V3_APPROVED", "V3_CHANGES_REQUESTED"] satisfies PipelineEvent[])(
    "applyEvent refuse %s venant de l'orchestrateur (ou du système), avant toute lecture en base",
    async (event) => {
      for (const actor of [{ kind: "agent", agentId: 0 }, { kind: "system" }] satisfies Actor[]) {
        await expect(applyEvent({ db: unreachableDb, notifier: { notify: async () => {} } }, { videoId: VIDEO_ID, event, actor })).rejects.toBeInstanceOf(TransitionError);
      }
    },
  );
});

// Base injoignable : applyEvent doit refuser une décision V1/V2/V3 d'un agent sans jamais l'interroger.
const unreachableDb = createTestDb("postgresql://personne@127.0.0.1:9/aucune");
afterAll(() => unreachableDb.$disconnect());

describe("onSuccess idempotent, sans transition", () => {
  it("rejoué : même résultat, rien d'écrit (ports en lecture seule)", async () => {
    const test = setup([]);
    const output = makeOutput();
    expect(await recordProposal(test.ports, test.input, output)).toBe("recorded");
    expect(await recordProposal(test.ports, test.input, output)).toBe("recorded");
    expect(Object.keys(test.ports).sort()).toEqual(["isActive", "loadProject", "now", "readRawBudget"]);
  });

  it("proposition périmée (la vidéo a bougé) ou vidéo disparue : rien à faire", async () => {
    const test = setup([]);
    test.setProject(makeProject({ stage: "AWAITING_V2" }));
    expect(await recordProposal(test.ports, test.input, makeOutput())).toBe("stale");
    test.setProject(null);
    expect(await recordProposal(test.ports, test.input, makeOutput())).toBe("missing");
  });

  it("même clé de tâche : la sortie acceptée est réutilisée, le modèle n'est pas rappelé", async () => {
    const test = setup([json(makeOutput())]);
    await test.run();
    expect(await test.run()).toMatchObject({ status: "ok", reused: true });
    expect(test.llm.requests).toHaveLength(1);
  });
});
