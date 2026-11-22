// Tests sur une vraie base migrée. Ignorés sans TEST_DATABASE_URL (voir .env.example).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { createTestDb } from "@/lib/testing/testDb";
import { makeImageProvider, makePlans, makeVideoProvider } from "./fixtures";
import { generateMedia, type GenerationRecord } from "./generation";
import { createPrismaMediaPorts } from "./ports";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("médias générés en base (Asset.generationKey)", () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestDb(url ?? "");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function video() {
    const channel = await db.channel.create({ data: { name: "Test médias", niche: "test", platforms: ["TIKTOK"] } });
    return db.video.create({ data: { channelId: channel.id, title: "Vidéo médias", stage: "VISUALS_AND_AUDIO" } });
  }

  const record = (videoId: string, key: string): GenerationRecord => ({
    key,
    videoId,
    planId: "P02",
    attempt: 1,
    kind: "IMAGE",
    provider: "faux-image",
    durationS: null,
    media: { url: "https://media.test/p02.png", cost: 0.25, license: null },
  });

  it("une clé enregistrée deux fois : un seul Asset et un seul coût", async () => {
    const { id } = await video();
    const media = createPrismaMediaPorts(db, { image: null, video: null });
    const key = `${id}:P02:1:abc`;
    await media.recordGeneration(record(id, key));
    await media.recordGeneration(record(id, key));

    expect(await media.findGeneration(key)).toEqual({ url: "https://media.test/p02.png" });
    expect(await media.countGenerations(id, "P02")).toBe(1);
    expect((await db.video.findUniqueOrThrow({ where: { id } })).totalCost.toNumber()).toBe(0.25);
    expect(await media.findGeneration(`${id}:P02:2:abc`)).toBeNull();
  });

  it("generateMedia rejouée : rien n'est régénéré, le coût n'est compté qu'une fois", async () => {
    const { id } = await video();
    const image = makeImageProvider();
    const videoGen = makeVideoProvider();
    const media = createPrismaMediaPorts(db, { image, video: videoGen });
    const request = { videoId: id, plans: makePlans(), remainingBudget: 5, isStillActive: async () => true };

    expect(await generateMedia(media, request)).toMatchObject({ status: "done", generated: 5 });
    expect(await generateMedia(media, request)).toMatchObject({ status: "done", generated: 0, reused: 5 });
    expect(image.requests).toHaveLength(3);
    expect(await db.asset.findMany({ where: { videoId: id }, select: { planId: true, type: true }, orderBy: { planId: "asc" } })).toEqual([
      { planId: "P01", type: "VIDEO" },
      { planId: "P02", type: "IMAGE" },
      { planId: "P05", type: "IMAGE" },
      { planId: "P06", type: "IMAGE" },
      { planId: "P08", type: "VIDEO" },
    ]);
    expect((await db.video.findUniqueOrThrow({ where: { id } })).totalCost.toNumber()).toBeCloseTo(0.72, 4);
  });
});
