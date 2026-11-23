// Tests sur une vraie base migrée. Ignorés sans TEST_DATABASE_URL (voir .env.example).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { createTestDb } from "@/lib/testing/testDb";
import { applyReportToBible } from "./actionsLogic";
import { makeReport, TEST_BIBLE } from "./fixtures";
import { createPrismaHumanPorts } from "./humanPorts";
import { loadPeriod, saveReport } from "./ports";

const url = process.env.TEST_DATABASE_URL;
const HOUR = 60 * 60 * 1000;

describe.skipIf(!url)("analyste en base", () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestDb(url ?? "");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function channelWithBible() {
    const channel = await db.channel.create({ data: { name: "Test analyste", niche: "test", platforms: ["TIKTOK"] } });
    const bible = await db.bibleVersion.create({ data: { channelId: channel.id, version: 1, content: TEST_BIBLE, author: "HUMAN" } });
    await db.channel.update({ where: { id: channel.id }, data: { activeBibleVersionId: bible.id } });
    return { channel, bible };
  }

  it("saveReport rejoué : un seul rapport et ses deux expériences", async () => {
    const { channel } = await channelWithBible();
    const report = { channelId: channel.id, agentRunId: `run-${channel.id}`, period: "2026-W48", content: makeReport() };
    expect(await saveReport(db, report)).toBe("created");
    expect(await saveReport(db, report)).toBe("exists");
    expect(await db.analystReport.count({ where: { channelId: channel.id } })).toBe(1);
    expect(await db.experiment.count({ where: { channelId: channel.id, status: "PROPOSED" } })).toBe(2);
  });

  it("« Appliquer à la bible » en double clic : une version v2 adoptée, la v1 intacte", async () => {
    const { channel, bible } = await channelWithBible();
    const report = await db.analystReport.create({ data: { channelId: channel.id, agentRunId: `run-b-${channel.id}`, period: "2026-W48", content: makeReport({ maj_bible: ["Ligne apprise"] }) } });
    const ports = createPrismaHumanPorts(db);
    const input = { reportId: report.id, channelId: channel.id, selected: [0] };
    const results = await Promise.allSettled([applyReportToBible(ports, input), applyReportToBible(ports, input)]);
    expect(results.some((result) => result.status === "fulfilled" && result.value.message.startsWith("Bible v2 créée"))).toBe(true);

    const versions = await db.bibleVersion.findMany({ where: { channelId: channel.id }, orderBy: { version: "asc" } });
    expect(versions.map((version) => [version.version, version.author])).toEqual([
      [1, "HUMAN"],
      [2, "AGENT_10"],
    ]);
    expect(versions[0]?.content).toBe(bible.content);
    expect(versions[1]?.content).toContain("[2026-W48] Ligne apprise");
    expect((await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).activeBibleVersionId).toBe(versions[1]?.id);
    expect((await db.analystReport.findUniqueOrThrow({ where: { id: report.id } })).appliedBibleVersionId).toBe(versions[1]?.id);
    expect(await applyReportToBible(ports, input)).toEqual({ ok: true, message: "Déjà appliqué : bible v2." });
  });

  it("loadPeriod : publications de la fenêtre et dernier relevé à la date de référence", async () => {
    const { channel } = await channelWithBible();
    const now = new Date("2026-11-23T06:00:00Z");
    const video = await db.video.create({ data: { channelId: channel.id, title: "Publiée", stage: "PUBLISHED" } });
    // Le trigger sur Publication exige une V3 approuvée.
    await db.validation.create({ data: { videoId: video.id, gate: "V3", decision: "APPROVED", decidedBy: "test" } });
    const publication = await db.publication.create({ data: { videoId: video.id, platform: "TIKTOK", status: "PUBLISHED", aiLabel: false, publishedAt: new Date(now.getTime() - 100 * HOUR) } });
    const stat = { views: 0, avgWatchTimeS: 30, completionRate: 0.4, shares: 1, saves: 1, followersGained: 1 };
    await db.stat.create({ data: { ...stat, publicationId: publication.id, date: new Date("2026-11-21"), views: 500 } });
    await db.stat.create({ data: { ...stat, publicationId: publication.id, date: new Date("2026-11-22"), views: 900 } });
    await db.stat.create({ data: { ...stat, publicationId: publication.id, date: new Date("2026-11-30"), views: 5_000 } });

    const period = await loadPeriod(db, channel.id, new Date(now.getTime() - 28 * 24 * HOUR), now);
    expect(period.samples).toEqual([expect.objectContaining({ videoId: video.id, platform: "TIKTOK", stat: expect.objectContaining({ views: 900 }) })]);
    expect(period.videos).toEqual([expect.objectContaining({ id: video.id, title: "Publiée", publications: [expect.objectContaining({ platform: "TIKTOK" })] })]);
  });
});
