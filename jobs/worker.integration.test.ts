// Tests sur une vraie base migrée et seedée. Ignorés sans TEST_DATABASE_URL.
import { createTestDb } from "@/lib/testing/testDb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getAgentMeta } from "@/agents/_shared/catalog";
import { createPlaceholderDefinition } from "@/agents/_shared/placeholder";
import type { AgentJobInput, AnyAgentDefinition } from "@/agents/_shared/types";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { applyEvent, completeStage, type PipelineDeps } from "@/lib/pipeline/service";
import { claimNextJob, MAX_JOB_ATTEMPTS, requeueStaleJobs } from "@/lib/queue/queue";
import type { LlmProvider } from "@/lib/providers/llm";
import type { Notification } from "@/lib/providers/notify";
import { processNextJob, type JobDeps } from "./handlers";
import { enqueueDueTasks, sendDueReminders, STRATEGY_PATH } from "./schedule";

const url = process.env.TEST_DATABASE_URL;
const human = { kind: "human" as const, name: "moi@example.test" };

describe.skipIf(!url)("worker sur base réelle", () => {
  let db: PrismaClient;
  let sent: Notification[];
  let originalModel = "";

  beforeAll(async () => {
    db = createTestDb(url ?? "");
    originalModel = (await db.agent.findUniqueOrThrow({ where: { id: 4 } })).model;
    await db.agent.update({ where: { id: 4 }, data: { model: "modele-test" } });
  });

  afterAll(async () => {
    await db.agent.update({ where: { id: 4 }, data: { model: originalModel } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    sent = [];
    // Chaque test part d'une file vide : les tâches des autres fichiers ne doivent pas être prises.
    await db.agentJob.updateMany({ where: { status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "FAILED", lastError: "nettoyage de test" } });
  });

  const notifier = { notify: async (notification: Notification) => void sent.push(notification) };
  const pipeline = (): PipelineDeps => ({ db, notifier });

  async function videoInScript(): Promise<{ videoId: string; channelId: string }> {
    const channel = await db.channel.create({ data: { name: "Test worker", niche: "test", platforms: ["TIKTOK"] } });
    const bible = await db.bibleVersion.create({ data: { channelId: channel.id, version: 1, content: "niche: test", author: "HUMAN" } });
    await db.channel.update({ where: { id: channel.id }, data: { activeBibleVersionId: bible.id } });
    const video = await db.video.create({ data: { channelId: channel.id, title: "Vidéo worker", stage: "AWAITING_V2" } });
    await applyEvent(pipeline(), { videoId: video.id, event: "V2_CHANGES_REQUESTED", actor: human, note: "plus court" });
    return { videoId: video.id, channelId: channel.id };
  }

  /** Faux scénariste : renvoie un titre et fait avancer la vidéo, comme le fera le vrai fork. */
  function fakeScriptwriter(received: AgentJobInput[]): AnyAgentDefinition {
    return {
      id: 4,
      slug: "04-scenariste",
      name: "Scénariste",
      promptFile: "prompt.md",
      outputSchema: z.object({ titre: z.string() }),
      async buildVariables(input) {
        received.push(input);
        return { IDEE: "{}", DOSSIER: "{}", APPRENTISSAGES: "aucun", DERNIERS_SCRIPTS: "[]", DUREE_S: "77" };
      },
      async onSuccess(_output, input) {
        await completeStage(pipeline(), { videoId: input.videoId ?? "", event: "SCRIPT_DONE", actor: { kind: "agent", agentId: 4 } });
      },
    };
  }

  const llm = (text: string | Error): LlmProvider => ({
    name: "fake",
    async complete() {
      if (text instanceof Error) throw text;
      return { text, inputTokens: 1, outputTokens: 1, cost: 0 };
    },
  });

  it("exécute la tâche d'un agent de bout en bout : la vidéo passe en V2 et la tâche est terminée", async () => {
    const { videoId } = await videoInScript();
    const received: AgentJobInput[] = [];
    const deps: JobDeps = { db, notifier, llm: llm('{"titre": "ok"}'), definitionFor: () => fakeScriptwriter(received) };

    expect(await processNextJob(deps, claimNextJob)).toBe(true);

    expect(received).toEqual([expect.objectContaining({ videoId, note: "plus court" })]);
    expect(await db.video.findUniqueOrThrow({ where: { id: videoId } })).toMatchObject({ stage: "AWAITING_V2" });
    expect(await db.agentJob.findFirstOrThrow({ where: { videoId } })).toMatchObject({ status: "DONE", attempts: 1 });
    expect(sent).toEqual([expect.objectContaining({ title: "V2 · Script à valider" })]);
    expect(await processNextJob(deps, claimNextJob)).toBe(false);
  });

  it("laisse la tâche en file tant qu'aucun fournisseur LLM n'est configuré", async () => {
    const { videoId } = await videoInScript();
    await processNextJob({ db, notifier, llm: null }, claimNextJob);
    const job = await db.agentJob.findFirstOrThrow({ where: { videoId } });
    expect(job).toMatchObject({ status: "QUEUED", lastError: "Aucun fournisseur LLM configuré.", lockedAt: null });
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
    expect(await claimNextJob(db)).toBeNull();
  });

  it("garde en file un agent pas encore implémenté (définition provisoire)", async () => {
    const { videoId } = await videoInScript();
    // Définition provisoire injectée : le vrai scénariste est implémenté depuis la fusion de son fork.
    const placeholder: AnyAgentDefinition = createPlaceholderDefinition(getAgentMeta(4), z.object({}));
    await processNextJob({ db, notifier, llm: llm("{}"), definitionFor: () => placeholder }, claimNextJob);
    expect(await db.agentJob.findFirstOrThrow({ where: { videoId } })).toMatchObject({ status: "QUEUED", lastError: "Agent à implémenter : Scénariste" });
  });

  it("ignore une tâche dont la vidéo a changé d'étape", async () => {
    const { videoId } = await videoInScript();
    await applyEvent(pipeline(), { videoId, event: "ABANDONED", actor: human });
    await db.agentJob.updateMany({ where: { videoId }, data: { status: "QUEUED" } });
    await processNextJob({ db, notifier, llm: llm("{}") }, claimNextJob);
    expect(await db.agentJob.findFirstOrThrow({ where: { videoId } })).toMatchObject({ status: "DONE", lastError: "Ignorée : la vidéo a changé d'étape." });
  });

  it("relance après une panne du fournisseur, puis abandonne et alerte au-delà du maximum", async () => {
    const { videoId } = await videoInScript();
    const deps: JobDeps = { db, notifier, llm: llm(new Error("panne réseau")), definitionFor: () => fakeScriptwriter([]) };
    await processNextJob(deps, claimNextJob);
    expect(await db.agentJob.findFirstOrThrow({ where: { videoId } })).toMatchObject({ status: "QUEUED", lastError: "panne réseau" });

    await db.agentJob.updateMany({ where: { videoId }, data: { attempts: MAX_JOB_ATTEMPTS - 1, runAfter: new Date(0) } });
    await processNextJob(deps, claimNextJob);
    expect(await db.agentJob.findFirstOrThrow({ where: { videoId } })).toMatchObject({ status: "FAILED", attempts: MAX_JOB_ATTEMPTS });
    expect(sent.at(-1)).toMatchObject({ kind: "agent_failed", title: "Tâche abandonnée : Scénariste", path: `/validations?item=${videoId}` });
  });

  it("ne donne jamais la même tâche à deux workers, et reprend une tâche abandonnée", async () => {
    await videoInScript();
    await videoInScript();
    const [first, second, third] = await Promise.all([claimNextJob(db), claimNextJob(db), claimNextJob(db)]);
    const ids = [first?.id, second?.id, third?.id].filter((id) => id !== undefined);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);

    await db.agentJob.update({ where: { id: ids[0] ?? "" }, data: { lockedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    expect(await requeueStaleJobs(db)).toBe(1);
    expect(await claimNextJob(db)).toMatchObject({ id: ids[0], attempts: 2 });
  });

  // Parcourt toutes les chaînes de la base de test (une par test d'intégration) : délai large.
  it("planifie l'analyse et la veille une seule fois par semaine", { timeout: 60_000 }, async () => {
    const monday = new Date(2026, 11, 7, 7, 30);
    const first = await enqueueDueTasks(pipeline(), monday);
    const second = await enqueueDueTasks(pipeline(), new Date(2026, 11, 9, 12));
    expect(first.filter((entry) => entry === "analyse 2026-W50").length).toBeGreaterThan(0);
    expect(first.filter((entry) => entry === "veille 2026-W50").length).toBe(first.length / 2);
    expect(second).toEqual([]);
  });

  it("rappel mensuel du stratège : une fois par chaîne et par mois, pas si une analyse a déjà été lancée", async () => {
    const reminded = await db.channel.create({ data: { name: "Test rappel", niche: "test", platforms: ["TIKTOK"] } });
    const launched = await db.channel.create({ data: { name: "Test rappel lancé", niche: "test", platforms: ["TIKTOK"] } });
    const month = new Date(2031, 2, 5, 10);
    await db.agentJob.create({
      data: { jobKey: `strategie:${launched.id}:test`, kind: "AGENT", agentId: 1, channelId: launched.id, status: "DONE", createdAt: new Date(2031, 2, 2) },
    });

    const first = await sendDueReminders(pipeline(), month);
    const second = await sendDueReminders(pipeline(), new Date(2031, 2, 20, 10));

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
    expect(await db.reminder.findUnique({ where: { key: `strategie:${reminded.id}:2031-03` } })).not.toBeNull();
    expect(await db.reminder.findUnique({ where: { key: `strategie:${launched.id}:2031-03` } })).toBeNull();
    expect(sent.filter((notification) => notification.kind === "reminder").every((notification) => notification.path === STRATEGY_PATH)).toBe(true);
  });
});
