// Tests sur une vraie base migrée et seedée. Ignorés sans TEST_DATABASE_URL (voir .env.example).
import { createTestDb } from "@/lib/testing/testDb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Stage } from "@/lib/generated/prisma/client";
import type { Notification } from "@/lib/providers/notify";
import { applyEvent, blockVideo, completeStage, decideIdeas, proposeIdeas, requestRender, requestScout, restartEdit, resumeVideo, TransitionError, type Actor, type PipelineDeps } from "./service";

const url = process.env.TEST_DATABASE_URL;
const human: Actor = { kind: "human", name: "moi@example.test" };
const agent4: Actor = { kind: "agent", agentId: 4 };

describe.skipIf(!url)("pipeline sur base réelle", () => {
  let db: PrismaClient;
  let sent: Notification[];
  let deps: PipelineDeps;

  beforeAll(() => {
    db = createTestDb(url ?? "");
    sent = [];
    deps = { db, notifier: { notify: async (notification) => void sent.push(notification) } };
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function channel() {
    return db.channel.create({ data: { name: "Test pipeline", niche: "test", platforms: ["TIKTOK"] } });
  }

  async function videoAt(stage: Stage, extra: { storyboard?: boolean; audio?: boolean } = {}) {
    const { id: channelId } = await channel();
    return db.video.create({
      data: {
        channelId,
        title: `Vidéo ${stage}`,
        stage,
        ...(extra.storyboard ? { storyboardJson: { plans: [] } } : {}),
        ...(extra.audio ? { audioJson: { texte_tts: "x" } } : {}),
      },
    });
  }

  const jobsOf = (videoId: string) => db.agentJob.findMany({ where: { videoId }, orderBy: { createdAt: "asc" } });

  it("V1 : propose les idées, prévient une fois, puis lance le recherchiste sur les idées validées", async () => {
    const { id: channelId } = await channel();
    sent.length = 0;
    const [keep, drop] = await proposeIdeas(deps, channelId, [{ title: "Idée A", idea: { id: "I-1" } }, { title: "Idée B", idea: { id: "I-2" } }], { kind: "agent", agentId: 2 });
    expect(sent).toEqual([expect.objectContaining({ title: "V1 · Idées à trier", path: "/validations?item=v1" })]);

    await decideIdeas(deps, { videoIds: [keep ?? ""], approve: true, note: "angle historique", actor: human });
    await decideIdeas(deps, { videoIds: [drop ?? ""], approve: false, note: null, actor: human });

    expect(await db.video.findUniqueOrThrow({ where: { id: keep ?? "" } })).toMatchObject({ stage: "RESEARCH" });
    expect(await db.video.findUniqueOrThrow({ where: { id: drop ?? "" } })).toMatchObject({ stage: "REJECTED" });
    expect(await db.validation.findMany({ where: { videoId: { in: [keep ?? "", drop ?? ""] } }, select: { gate: true, decision: true } })).toEqual(
      expect.arrayContaining([{ gate: "V1", decision: "APPROVED" }, { gate: "V1", decision: "REJECTED" }]),
    );
    expect(await jobsOf(keep ?? "")).toMatchObject([{ agentId: 3, stage: "RESEARCH", status: "QUEUED", note: "angle historique" }]);
    expect(await jobsOf(drop ?? "")).toEqual([]);
  });

  it("refuse qu'un agent rende une décision V1, V2 ou V3", async () => {
    const video = await videoAt("AWAITING_V2");
    await expect(applyEvent(deps, { videoId: video.id, event: "V2_APPROVED", actor: { kind: "agent", agentId: 0 } })).rejects.toThrow(TransitionError);
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ stage: "AWAITING_V2" });
    expect(await db.validation.count({ where: { videoId: video.id } })).toBe(0);
  });

  it("V2 : une correction relance le scénariste avec la note, sous une nouvelle clé", async () => {
    const video = await videoAt("SCRIPT");
    sent.length = 0;
    await completeStage(deps, { videoId: video.id, event: "SCRIPT_DONE", actor: agent4 });
    expect(sent).toEqual([expect.objectContaining({ title: "V2 · Script à valider", path: `/validations?item=${video.id}` })]);

    await applyEvent(deps, { videoId: video.id, event: "V2_CHANGES_REQUESTED", actor: human, note: "accroche plus courte" });
    await completeStage(deps, { videoId: video.id, event: "SCRIPT_DONE", actor: agent4 });
    await applyEvent(deps, { videoId: video.id, event: "V2_CHANGES_REQUESTED", actor: human, note: "encore plus courte" });

    const jobs = await jobsOf(video.id);
    expect(jobs.map((job) => [job.agentId, job.note])).toEqual([
      [4, "accroche plus courte"],
      [4, "encore plus courte"],
    ]);
    expect(new Set(jobs.map((job) => job.jobKey)).size).toBe(2);
  });

  it("lance les agents 5 et 6 en parallèle, et n'avance qu'avec leurs deux sorties", async () => {
    const video = await videoAt("AWAITING_V2");
    await applyEvent(deps, { videoId: video.id, event: "V2_APPROVED", actor: human });
    expect((await jobsOf(video.id)).map((job) => job.agentId)).toEqual([5, 6]);

    await db.video.update({ where: { id: video.id }, data: { storyboardJson: { plans: [] } } });
    expect(await completeStage(deps, { videoId: video.id, event: "MEDIA_DONE", actor: { kind: "agent", agentId: 5 } })).toEqual({ waiting: true });
    await db.video.update({ where: { id: video.id }, data: { audioJson: { texte_tts: "x" } } });
    expect(await completeStage(deps, { videoId: video.id, event: "MEDIA_DONE", actor: { kind: "agent", agentId: 6 } })).toMatchObject({ to: "EDIT" });
    expect((await jobsOf(video.id)).map((job) => job.agentId)).toEqual([5, 6, 7]);
  });

  it("revenir en VISUALS_AND_AUDIO efface l'ancien storyboard et l'ancien plan sonore : MEDIA_DONE attend les nouveaux", async () => {
    const video = await videoAt("AWAITING_V3", { storyboard: true, audio: true });
    await applyEvent(deps, { videoId: video.id, event: "V3_CHANGES_REQUESTED", actor: human, note: "plans trop sombres", returnTo: "VISUALS_AND_AUDIO" });
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ stage: "VISUALS_AND_AUDIO", storyboardJson: null, audioJson: null });

    await db.video.update({ where: { id: video.id }, data: { audioJson: { texte_tts: "nouveau" } } });
    expect(await completeStage(deps, { videoId: video.id, event: "MEDIA_DONE", actor: { kind: "agent", agentId: 6 } })).toEqual({ waiting: true });

    await db.video.update({ where: { id: video.id }, data: { storyboardJson: { plans: [] } } });
    await blockVideo(deps, { videoId: video.id, reason: "budget", actor: { kind: "agent", agentId: 5 } });
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ stage: "NEEDS_FIX", storyboardJson: { plans: [] } });
    await resumeVideo(deps, { videoId: video.id, actor: human });
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ stage: "VISUALS_AND_AUDIO", storyboardJson: null, audioJson: null });
  });

  it("V3 : le GO programme la vidéo et lance l'agent publication ; la publication devient possible", async () => {
    const video = await videoAt("AWAITING_V3");
    await applyEvent(deps, { videoId: video.id, event: "V3_APPROVED", actor: human });
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ stage: "SCHEDULED" });
    expect((await jobsOf(video.id)).map((job) => job.agentId)).toEqual([9]);

    await expect(db.publication.create({ data: { videoId: video.id, platform: "TIKTOK", aiLabel: true } })).resolves.toBeTruthy();
    await expect(applyEvent(deps, { videoId: video.id, event: "PUBLISHED", actor: { kind: "system" } })).resolves.toMatchObject({ to: "PUBLISHED" });
  });

  it("bloque toute publication sans V3 approuvée, en code et en base", async () => {
    const video = await videoAt("SCHEDULED");
    await expect(applyEvent(deps, { videoId: video.id, event: "PUBLISHED", actor: { kind: "system" } })).rejects.toThrow(/V3/);
    await expect(db.publication.create({ data: { videoId: video.id, platform: "TIKTOK", aiLabel: true } })).rejects.toThrow(/validation V3/);
  });

  it("V3 : une correction renvoie à l'étape choisie et relance son agent", async () => {
    const video = await videoAt("AWAITING_V3");
    await applyEvent(deps, { videoId: video.id, event: "V3_CHANGES_REQUESTED", actor: human, note: "boucle finale", returnTo: "SCRIPT" });
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ stage: "SCRIPT" });
    expect(await jobsOf(video.id)).toMatchObject([{ agentId: 4, note: "boucle finale" }]);
  });

  it("n'accepte qu'une décision quand deux arrivent en même temps", async () => {
    const video = await videoAt("AWAITING_V2");
    const results = await Promise.allSettled([
      applyEvent(deps, { videoId: video.id, event: "V2_APPROVED", actor: human }),
      applyEvent(deps, { videoId: video.id, event: "V2_APPROVED", actor: human }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.validation.count({ where: { videoId: video.id } })).toBe(1);
    expect((await jobsOf(video.id)).map((job) => job.agentId)).toEqual([5, 6]);
  });

  it("bloque une vidéo, annule ses tâches en file, puis la reprend à la même étape", async () => {
    const video = await videoAt("AWAITING_V2");
    await applyEvent(deps, { videoId: video.id, event: "V2_CHANGES_REQUESTED", actor: human, note: "x" });
    sent.length = 0;
    await blockVideo(deps, { videoId: video.id, reason: "Scénariste : 3 échecs", actor: { kind: "system" } });
    await blockVideo(deps, { videoId: video.id, reason: "doublon", actor: { kind: "system" } });

    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ stage: "NEEDS_FIX", blockedAt: "SCRIPT", blockedReason: "Scénariste : 3 échecs" });
    expect(sent).toHaveLength(1);
    expect(await jobsOf(video.id)).toMatchObject([{ status: "FAILED" }]);

    await applyEvent(deps, { videoId: video.id, event: "RESUMED", actor: human, note: "nouvel angle" });
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ stage: "SCRIPT", blockedAt: null, blockedReason: null });
    expect((await jobsOf(video.id)).map((job) => job.status)).toEqual(["FAILED", "QUEUED"]);
    expect(await db.stageTransition.count({ where: { videoId: video.id } })).toBe(3);
  });

  it("relance la recherche avec les sources de l'humain et la note", async () => {
    const video = await videoAt("RESEARCH");
    await blockVideo(deps, { videoId: video.id, reason: "aucun fait assez fiable", actor: { kind: "agent", agentId: 3 } });

    await resumeVideo(deps, { videoId: video.id, actor: human, note: "voir le brevet", researchSources: ["https://a.example/brevet", "https://b.example"] });

    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({
      stage: "RESEARCH",
      researchSources: ["https://a.example/brevet", "https://b.example"],
    });
    expect(await jobsOf(video.id)).toMatchObject([{ agentId: 3, status: "QUEUED", note: "voir le brevet" }]);
  });

  it("n'enregistre pas de sources pour une vidéo bloquée ailleurs qu'en recherche", async () => {
    const video = await videoAt("SCRIPT");
    await blockVideo(deps, { videoId: video.id, reason: "x", actor: { kind: "system" } });
    await resumeVideo(deps, { videoId: video.id, actor: human, researchSources: ["https://a.example"] });
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ stage: "SCRIPT", researchSources: [] });
  });

  it("ne lance qu'une veille par semaine", async () => {
    const { id: channelId } = await channel();
    const monday = new Date(2026, 10, 23, 7);
    expect(await requestScout(deps, channelId, monday)).toEqual({ queued: true, week: "2026-W48" });
    expect(await requestScout(deps, channelId, new Date(2026, 10, 27, 18))).toEqual({ queued: false, week: "2026-W48" });
    expect(await db.agentJob.count({ where: { channelId, agentId: 2 } })).toBe(1);
  });

  async function videoAtEdit() {
    const video = await videoAt("VISUALS_AND_AUDIO", { storyboard: true, audio: true });
    await completeStage(deps, { videoId: video.id, event: "MEDIA_DONE", actor: { kind: "agent", agentId: 6 } });
    await db.video.update({ where: { id: video.id }, data: { timelineJson: { pistes: {} } } });
    return video;
  }

  it("son changé au montage : timeline effacée, monteur relancé une fois (l'ancienne tâche en file est annulée)", async () => {
    const video = await videoAtEdit();
    expect(await restartEdit(deps, video.id)).toBe("restarted");
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ stage: "EDIT", timelineJson: null });
    const jobs = await jobsOf(video.id);
    expect(jobs.filter((job) => job.agentId === 7).map((job) => job.status)).toEqual(["FAILED", "QUEUED"]);
    expect(jobs.at(-1)?.jobKey).toMatch(/:agent-7:relance-2$/);
    expect(await restartEdit(deps, video.id)).toBe("restarted");
    expect((await jobsOf(video.id)).at(-1)?.jobKey).toMatch(/:agent-7:relance-3$/);
  });

  it("son changé, vidéo bloquée au montage : timeline effacée seulement ; ailleurs : rien", async () => {
    const blocked = await videoAtEdit();
    await blockVideo(deps, { videoId: blocked.id, reason: "média manquant", actor: { kind: "agent", agentId: 7 } });
    expect(await restartEdit(deps, blocked.id)).toBe("cleared");
    expect(await db.video.findUniqueOrThrow({ where: { id: blocked.id } })).toMatchObject({ timelineJson: null });
    const early = await videoAt("VISUALS_AND_AUDIO");
    expect(await restartEdit(deps, early.id)).toBe("none");
  });

  it("« Lancer le rendu » : une seule tâche active, rattachée au passage au rendu", async () => {
    const video = await videoAtEdit();
    expect(await requestRender(deps, video.id)).toEqual({ queued: false, reason: "La vidéo n'attend pas de rendu à cette étape." });
    await completeStage(deps, { videoId: video.id, event: "EDIT_DONE", actor: { kind: "agent", agentId: 7 } });
    expect(await requestRender(deps, video.id)).toEqual({ queued: false, reason: "Un rendu est déjà en file ou en cours pour cette vidéo." });
    await db.agentJob.updateMany({ where: { videoId: video.id, kind: "RENDER" }, data: { status: "FAILED" } });
    expect(await requestRender(deps, video.id)).toEqual({ queued: true });
    const renders = (await jobsOf(video.id)).filter((job) => job.kind === "RENDER");
    expect(renders).toHaveLength(2);
    expect(renders[1]).toMatchObject({ stage: "RENDER", status: "QUEUED", transitionId: renders[0]?.transitionId });
  });
});
