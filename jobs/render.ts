import { missingPlanIds } from "@/agents/07-monteur/rules";
import type { Output as Timeline } from "@/agents/07-monteur/schema";
import { parseStoredTimeline } from "@/agents/07-monteur/sources";
import type { AgentJob, PrismaClient, Stage } from "@/lib/generated/prisma/client";
import { Prisma } from "@/lib/generated/prisma/client";
import { blockVideo, completeStage, type Actor, type PipelineDeps } from "@/lib/pipeline/service";
import type { RenderProvider } from "@/lib/providers/render";
import { COMPOSITION_ID } from "@/remotion/logic";
import type { JobOutcome } from "./outcome";

// Tâche RENDER : la timeline de l'agent 7 (Video.timelineJson) devient un MP4 1080×1920 (CLAUDE.md §11, étape 6),
// enregistré en Asset RENDER, puis la vidéo passe au contrôle qualité. Un rendu réussi n'est jamais refait.

const HOUR = 60 * 60 * 1000;

export const TIMELINE_UNREADABLE = "Rendu refusé : timeline absente ou illisible (relance le montage).";

export const RENDER_NOT_CONFIGURED =
  "Rendu non configuré : renseigne le stockage S3 (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL) pour y déposer le MP4.";

export type RenderVideo = { stage: Stage; timeline: unknown };
export type RenderRecord = { url: string; provider: string; durationS: number; cost: number; generationKey: string };

export type RenderPorts = {
  loadVideo(videoId: string): Promise<RenderVideo | null>;
  /** URL des Asset MUSIC qui ont une licence */
  licensedMusicUrls(videoId: string): Promise<string[]>;
  findRender(generationKey: string): Promise<{ url: string } | null>;
  /** Asset RENDER + coût ajouté à la vidéo, dans une transaction ; une clé déjà enregistrée est ignorée */
  recordRender(videoId: string, record: RenderRecord): Promise<void>;
  completeRender(videoId: string): Promise<void>;
  blockVideo(videoId: string, reason: string): Promise<void>;
};

type RenderJob = Pick<AgentJob, "id" | "videoId" | "transitionId" | "attempts">;

/** Clé du rendu : une par vidéo et par passage à l'étape RENDER (une relance manuelle garde la même). */
export function renderKey(job: RenderJob & { videoId: string }): string {
  return `${job.videoId}:render:${job.transitionId ?? job.id}`;
}

/** Ce qui interdit le rendu : plan sans fichier, musique sans licence (CLAUDE.md §8). */
export function renderRefusal(timeline: Timeline, licensedMusic: readonly string[]): string | null {
  const missing = missingPlanIds(timeline);
  if (missing.length > 0) return `Rendu refusé : média manquant pour ${missing.join(", ")}.`;
  const unlicensed = timeline.pistes.audio.filter((clip) => clip.type === "musique" && !licensedMusic.includes(clip.src));
  if (unlicensed.length > 0) return "Rendu refusé : la musique de la timeline n'a pas de licence enregistrée.";
  return null;
}

export async function runRenderJob(job: RenderJob, ports: RenderPorts, renderer: RenderProvider | null): Promise<JobOutcome> {
  const { videoId } = job;
  if (!videoId) return { kind: "failed", reason: "Tâche de rendu sans vidéo." };
  const video = await ports.loadVideo(videoId);
  if (!video) return { kind: "failed", reason: "Vidéo introuvable." };
  if (video.stage !== "RENDER") return { kind: "done", note: "Ignorée : la vidéo n'est plus à l'étape du rendu." };

  const timeline = parseStoredTimeline(video.timeline);
  const refusal = timeline ? renderRefusal(timeline, await ports.licensedMusicUrls(videoId)) : TIMELINE_UNREADABLE;
  if (refusal !== null || timeline === null) return refuse(ports, videoId, refusal ?? TIMELINE_UNREADABLE);

  const key = renderKey({ ...job, videoId });
  if (!(await ports.findRender(key))) {
    if (!renderer) return { kind: "retry", delayMs: HOUR, reason: RENDER_NOT_CONFIGURED, alert: job.attempts <= 1 };
    const result = await renderer.render({ compositionId: COMPOSITION_ID, inputProps: timeline, outputKey: `rendus/${videoId}/${key.replaceAll(":", "-")}.mp4` });
    await ports.recordRender(videoId, { ...result, provider: renderer.name, generationKey: key });
  }
  await completeIfStillRendering(ports, videoId);
  return { kind: "done" };
}

async function refuse(ports: RenderPorts, videoId: string, reason: string): Promise<JobOutcome> {
  await ports.blockVideo(videoId, reason);
  return { kind: "done", note: reason };
}

async function completeIfStillRendering(ports: RenderPorts, videoId: string): Promise<void> {
  try {
    await ports.completeRender(videoId);
  } catch (error) {
    // La vidéo a changé d'étape pendant le rendu (abandon, blocage) : le MP4 reste enregistré, rien d'autre à faire.
    if ((await ports.loadVideo(videoId))?.stage === "RENDER") throw error;
  }
}

const SYSTEM: Actor = { kind: "system" };

export function createPrismaRenderPorts(deps: PipelineDeps): RenderPorts {
  const db: PrismaClient = deps.db;
  return {
    async loadVideo(videoId) {
      const video = await db.video.findUnique({ where: { id: videoId }, select: { stage: true, timelineJson: true } });
      return video ? { stage: video.stage, timeline: video.timelineJson } : null;
    },
    async licensedMusicUrls(videoId) {
      const assets = await db.asset.findMany({ where: { videoId, type: "MUSIC", license: { not: null } }, select: { url: true, license: true } });
      return assets.filter((asset) => (asset.license ?? "").trim() !== "").map((asset) => asset.url);
    },
    async findRender(generationKey) {
      return db.asset.findUnique({ where: { generationKey }, select: { url: true } });
    },
    async recordRender(videoId, record) {
      try {
        await db.$transaction([
          db.asset.create({ data: { videoId, type: "RENDER", url: record.url, provider: record.provider, durationS: record.durationS, generationKey: record.generationKey } }),
          db.video.update({ where: { id: videoId }, data: { totalCost: { increment: record.cost } } }),
        ]);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
        throw error;
      }
    },
    async completeRender(videoId) {
      await completeStage(deps, { videoId, event: "RENDER_DONE", actor: SYSTEM });
    },
    async blockVideo(videoId, reason) {
      await blockVideo(deps, { videoId, reason, actor: SYSTEM });
    },
  };
}
