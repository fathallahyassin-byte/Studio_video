// Tests sur une vraie base migrée. Ignorés sans TEST_DATABASE_URL (voir .env.example).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { createTestDb } from "@/lib/testing/testDb";
import { createPrismaVoiceStore } from "./ports";
import type { VoiceRecord } from "./voice";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("voix générées en base (Asset VOICE, horodatage)", () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestDb(url ?? "");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function video() {
    const channel = await db.channel.create({ data: { name: "Test voix", niche: "test", platforms: ["TIKTOK"] } });
    return db.video.create({ data: { channelId: channel.id, title: "Vidéo voix", stage: "VISUALS_AND_AUDIO" } });
  }

  const record = (videoId: string, key: string, withWords: boolean): VoiceRecord => ({
    key,
    videoId,
    attempt: 1,
    text: "Ton trombone cache un secret.",
    url: "https://voix.test/voix.mp3",
    provider: "faux-tts",
    durationS: 2.4,
    words: withWords ? [{ word: "Ton", startS: 0, endS: 0.3 }] : null,
    timingSource: withWords ? "tts" : null,
    cost: 0.05,
  });

  const cost = async (videoId: string) => (await db.video.findUniqueOrThrow({ where: { id: videoId } })).totalCost.toNumber();

  it("une voix enregistrée deux fois : un seul Asset et un seul coût, retrouvée avec son horodatage", async () => {
    const { id } = await video();
    const store = createPrismaVoiceStore(db);
    const key = `${id}:voix:1:abc`;
    await store.recordVoice(record(id, key, true));
    await store.recordVoice(record(id, key, true));

    expect(await store.countVoices(id)).toBe(1);
    expect(await cost(id)).toBeCloseTo(0.05);
    expect(await store.findVoice(key)).toEqual({ key, url: "https://voix.test/voix.mp3", provider: "faux-tts", durationS: 2.4, words: [{ word: "Ton", startS: 0, endS: 0.3 }], timingSource: "tts" });
    expect(await store.findVoice(`${id}:voix:9:zzz`)).toBeNull();
  });

  it("horodatage Whisper ajouté une seule fois, même rejoué", async () => {
    const { id } = await video();
    const store = createPrismaVoiceStore(db);
    const key = `${id}:voix:1:def`;
    await store.recordVoice(record(id, key, false));
    expect((await store.findVoice(key))?.words).toBeNull();

    const words = [{ word: "Ton", startS: 0, endS: 0.4 }];
    await store.recordTimings(key, words, 0.01);
    await store.recordTimings(key, words, 0.01);

    expect(await store.findVoice(key)).toMatchObject({ words, timingSource: "stt" });
    expect(await cost(id)).toBeCloseTo(0.06);
  });
});
