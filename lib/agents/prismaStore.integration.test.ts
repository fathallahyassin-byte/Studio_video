// Tests sur une vraie base migrée et seedée. Ignorés sans TEST_DATABASE_URL :
//   TEST_DATABASE_URL="postgresql://studio:studio@localhost:5432/studio" npm run test
import { createTestDb } from "@/lib/testing/testDb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentDefinition } from "@/agents/_shared/types";
import { PrismaClient } from "@/lib/generated/prisma/client";
import type { LlmProvider } from "@/lib/providers/llm";
import { createPrismaRunStore } from "./prismaStore";
import { runAgent } from "./runAgent";

const url = process.env.TEST_DATABASE_URL;
const schema = z.object({ titre: z.string() });

const definition: AgentDefinition<null, typeof schema> = {
  id: 4,
  slug: "04-scenariste",
  name: "Scénariste",
  promptFile: "prompt.md",
  outputSchema: schema,
  async buildVariables() {
    return { IDEE: "{}", DOSSIER: "{}", APPRENTISSAGES: "aucun", DERNIERS_SCRIPTS: "[]", DUREE_S: "77" };
  },
  async onSuccess() {},
};

function scriptedLlm(texts: string[]): LlmProvider {
  return {
    name: "fake",
    async complete() {
      return { text: texts.shift() ?? "", inputTokens: 10, outputTokens: 5, cost: 0.01 };
    },
  };
}

const notifier = { async notify() {} };

describe.skipIf(!url)("base réelle", () => {
  let db: PrismaClient;
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

  async function createVideo() {
    const channel = await db.channel.create({ data: { name: "Test", niche: "test", platforms: ["TIKTOK"] } });
    const bible = await db.bibleVersion.create({ data: { channelId: channel.id, version: 1, content: "niche: test", author: "HUMAN" } });
    await db.channel.update({ where: { id: channel.id }, data: { activeBibleVersionId: bible.id } });
    const video = await db.video.create({ data: { channelId: channel.id, title: "Test", stage: "SCRIPT" } });
    return { channel, bible, video };
  }

  it("refuse de modifier ou de supprimer une version de prompt ou de bible", async () => {
    const { bible } = await createVideo();
    const prompt = await db.promptVersion.findFirstOrThrow({ where: { agentId: 4 } });
    await expect(db.promptVersion.update({ where: { id: prompt.id }, data: { notes: "x" } })).rejects.toThrow(/immuable/);
    await expect(db.bibleVersion.delete({ where: { id: bible.id } })).rejects.toThrow(/immuable/);
  });

  it("refuse un Asset musical sans licence", async () => {
    const { video } = await createVideo();
    await expect(db.asset.create({ data: { videoId: video.id, type: "MUSIC", url: "s3://x", provider: "test" } })).rejects.toThrow();
    await expect(
      db.asset.create({ data: { videoId: video.id, type: "MUSIC", url: "s3://x", provider: "test", license: "CC-BY 4.0" } }),
    ).resolves.toMatchObject({ license: "CC-BY 4.0" });
  });

  it("enregistre une exécution réussie avec ses versions et son coût", async () => {
    const { channel, bible, video } = await createVideo();
    const store = createPrismaRunStore(db);

    const result = await runAgent(
      { definition, input: null, channelId: channel.id, videoId: video.id, jobKey: `${video.id}:SCRIPT:4` },
      { store, llm: scriptedLlm(["pas du json", '{"titre": "ok"}']), notifier },
    );

    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    const runs = await db.agentRun.findMany({ where: { videoId: video.id }, orderBy: { attempt: "asc" } });
    expect(runs.map((run) => run.status)).toEqual(["INVALID_JSON", "OK"]);
    expect(runs[1]).toMatchObject({ bibleVersionId: bible.id, model: "modele-test", output: { titre: "ok" } });
    expect(runs[1]?.successHandledAt).not.toBeNull();
    const updated = await db.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(updated.totalCost.toNumber()).toBeCloseTo(0.02);
  });

  it("passe la vidéo en NEEDS_FIX en gardant l'étape à reprendre", async () => {
    const { channel, video } = await createVideo();
    const store = createPrismaRunStore(db);

    const result = await runAgent(
      { definition, input: null, channelId: channel.id, videoId: video.id, jobKey: `${video.id}:SCRIPT:4` },
      { store, llm: scriptedLlm(["a", "b", "c"]), notifier },
    );

    expect(result.status).toBe("needs_fix");
    const updated = await db.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(updated).toMatchObject({ stage: "NEEDS_FIX", blockedAt: "SCRIPT" });
    expect(await db.agentRun.count({ where: { videoId: video.id } })).toBe(3);
  });
});
