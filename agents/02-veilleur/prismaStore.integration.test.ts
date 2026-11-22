// Tests sur une vraie base migrée et seedée. Ignorés sans TEST_DATABASE_URL (voir .env.example).
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";
import type { Notification } from "@/lib/providers/notify";
import type { PipelineDeps } from "@/lib/pipeline/service";
import { createPrismaScoutStore, SCOUT_AGENT_ID } from "./prismaStore";
import { saveScoutIdeas } from "./proposals";
import { withSignals } from "./settings";
import { LEARNING, makeIdea, makeOutput } from "./testing";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date();

// Postgres embarqué (`npx prisma dev`) : 20 transactions peuvent dépasser le délai par défaut de 5 s.
describe.skipIf(!url)("veilleur sur base réelle", { timeout: 120_000 }, () => {
  let db: PrismaClient;
  let sent: Notification[];
  let deps: PipelineDeps;
  let originalSettings: unknown;

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? "", max: 1 }) });
    sent = [];
    deps = { db, notifier: { notify: async (notification) => void sent.push(notification) } };
    originalSettings = (await db.agent.findUniqueOrThrow({ where: { id: SCOUT_AGENT_ID } })).settings;
  });

  afterAll(async () => {
    await db.agent.update({ where: { id: SCOUT_AGENT_ID }, data: { settings: toInputJson(originalSettings) } });
    await db.$disconnect();
  }, 120_000);

  const channel = () => db.channel.create({ data: { name: "Test veilleur", niche: "test", platforms: ["TIKTOK"] } });
  const store = () => createPrismaScoutStore(() => deps);

  it("lit les signaux, les enseignements et le backlog des 90 derniers jours", async () => {
    const { id: channelId } = await channel();
    await db.agent.update({ where: { id: SCOUT_AGENT_ID }, data: { settings: toInputJson(withSignals(originalSettings, "Tendance : vintage", NOW)) } });
    await db.video.create({ data: { channelId, title: "Pourquoi les crayons sont jaunes", stage: "PUBLISHED" } });
    const old = await db.video.create({ data: { channelId, title: "Vieille vidéo", stage: "PUBLISHED" } });
    await db.$executeRaw`UPDATE "Video" SET "createdAt" = now() - interval '120 days' WHERE id = ${old.id}`;

    expect(await store().loadSignals()).toBe("Tendance : vintage");
    expect(await store().loadLearnings(channelId)).toEqual([]);
    const recent = await store().listRecentVideos(channelId, new Date(NOW.getTime() - 90 * 86_400_000));
    expect(recent.map((video) => video.title)).toEqual(["Pourquoi les crayons sont jaunes"]);
  });

  it("lit les enseignements du dernier rapport de l'analyste", async () => {
    const { id: channelId } = await channel();
    const prompt = await db.promptVersion.findFirstOrThrow({ where: { agentId: 10 } });
    const run = await db.agentRun.create({
      data: { jobKey: `analyse:${channelId}`, attempt: 1, channelId, agentId: 10, promptVersionId: prompt.id, model: "modele-test", input: {}, status: "OK" },
    });
    await db.analystReport.create({ data: { channelId, agentRunId: run.id, period: "2026-W47", content: toInputJson({ enseignements: [LEARNING] }) } });
    expect(await store().loadLearnings(channelId)).toEqual([LEARNING]);
  });

  it("crée 20 vidéos en AWAITING_V1 une seule fois, même rejoué", async () => {
    const { id: channelId } = await channel();
    await db.video.create({ data: { channelId, title: "Pourquoi les crayons sont jaunes", stage: "PUBLISHED" } });
    sent.length = 0;
    const output = makeOutput({ semaine: "2026-W48" });

    await saveScoutIdeas(store(), output, { channelId, jobId: "job-integration" }, NOW);
    await saveScoutIdeas(store(), output, { channelId, jobId: "job-integration" }, NOW);

    const videos = await db.video.findMany({ where: { channelId, stage: "AWAITING_V1" }, select: { title: true, ideaJson: true } });
    expect(videos).toHaveLength(20);
    expect(sent).toHaveLength(1);
    const pencil = videos.find((video) => video.title === makeIdea(4).angle);
    expect(pencil?.ideaJson).toMatchObject({ id: "IDEE-005", proche_de: "Pourquoi les crayons sont jaunes", veille: { semaine: "2026-W48", jobId: "job-integration" } });
    expect(await store().listProposalsOfJob(channelId, "autre-job")).toEqual([]);
  });

  it("fait passer en AWAITING_V1 une vidéo restée en IDEA après un crash", async () => {
    const { id: channelId } = await channel();
    const stuck = await db.video.create({
      data: { channelId, title: "Bloquée", stage: "IDEA", ideaJson: toInputJson({ ...makeIdea(0), veille: { semaine: "2026-W48", jobId: "job-crash" }, proche_de: null }) },
    });

    const result = await saveScoutIdeas(store(), makeOutput({ semaine: "2026-W48" }), { channelId, jobId: "job-crash" }, NOW);

    expect(result).toEqual({ created: 19, confirmed: 1 });
    expect(await db.video.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({ stage: "AWAITING_V1" });
    expect(await db.video.count({ where: { channelId } })).toBe(20);
  });
});
