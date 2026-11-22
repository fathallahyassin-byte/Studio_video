import { agentCatalog, parseAgentId } from "@/agents/_shared/catalog";
import { loadScriptTarget } from "@/agents/04-scenariste/ui/loadScripts";
import { toScriptContent, type ScriptContent } from "@/agents/04-scenariste/ui/scripts";
import type { Platform, PrismaClient, Stage } from "@/lib/generated/prisma/client";
import { deriveAgentState, type AgentState } from "./agentStatus";
import { buildBoard, type BoardColumn } from "./board";
import { startOfMonth } from "./format";
import { parseAnalystReport, parseIdea, parseQaReport, type AnalystReportContent, type QaReport } from "./payloads";
import { buildQueue, QUEUE_STAGES, type QueueItem } from "./queue";
import type { V3ReturnStage } from "@/lib/pipeline/machine";

// Lectures en base pour les écrans du tableau de bord. Une seule chaîne pour l'instant : la plus ancienne.

const PUBLISHED_VISIBLE_DAYS = 14;
const HIDDEN_STAGES: Stage[] = ["PUBLISHED", "REJECTED"];

export const platformLabels: Record<Platform, string> = { TIKTOK: "TikTok", INSTAGRAM: "Reels", YOUTUBE: "Shorts" };

export async function getCurrentChannel(db: PrismaClient) {
  return db.channel.findFirst({ orderBy: { createdAt: "asc" } });
}

async function stagesInProgress(db: PrismaClient, channelId: string): Promise<Set<Stage>> {
  const groups = await db.video.groupBy({ by: ["stage"], where: { channelId, stage: { notIn: HIDDEN_STAGES } } });
  return new Set(groups.map((group) => group.stage));
}

async function loadQueue(db: PrismaClient, channelId: string): Promise<QueueItem[]> {
  const videos = await db.video.findMany({
    where: { channelId, stage: { in: [...QUEUE_STAGES] } },
    select: { id: true, number: true, title: true, stage: true, updatedAt: true },
  });
  return buildQueue(videos);
}

export async function getShellData(db: PrismaClient, channelId: string) {
  const [queue, stages, agents] = await Promise.all([
    loadQueue(db, channelId),
    stagesInProgress(db, channelId),
    db.agent.findMany({ select: { id: true, active: true } }),
  ]);
  const working = agents.filter((agent) => deriveAgentState({ id: parseAgentId(agent.id), active: agent.active }, stages) === "working");
  return { queueCount: queue.length, workingCount: working.length };
}

export type ProductionData = {
  columns: BoardColumn[];
  inProgress: number;
  queueCount: number;
  publishedThisMonth: number;
  costThisMonth: number;
  /** tâches d'agents en attente du worker */
  queuedJobs: number;
};

export async function getProductionData(db: PrismaClient, channelId: string, now: Date): Promise<ProductionData> {
  const monthStart = startOfMonth(now);
  const publishedSince = new Date(now.getTime() - PUBLISHED_VISIBLE_DAYS * 24 * 60 * 60 * 1000);
  const [videos, inProgress, queue, published, cost, queuedJobs] = await Promise.all([
    db.video.findMany({
      where: { channelId, stage: { not: "REJECTED" }, NOT: { stage: "PUBLISHED", updatedAt: { lt: publishedSince } } },
      select: { id: true, number: true, title: true, stage: true, blockedAt: true, blockedReason: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.video.count({ where: { channelId, stage: { notIn: HIDDEN_STAGES } } }),
    loadQueue(db, channelId),
    db.publication.findMany({
      where: { status: "PUBLISHED", publishedAt: { gte: monthStart }, video: { channelId } },
      distinct: ["videoId"],
      select: { videoId: true },
    }),
    db.agentRun.aggregate({ where: { channelId, createdAt: { gte: monthStart } }, _sum: { cost: true } }),
    db.agentJob.count({ where: { channelId, status: "QUEUED" } }),
  ]);
  return {
    columns: buildBoard(videos),
    inProgress,
    queueCount: queue.length,
    publishedThisMonth: published.length,
    costThisMonth: cost._sum.cost?.toNumber() ?? 0,
    queuedJobs,
  };
}

export type IdeaRow = { videoId: string; number: number; title: string; score: number | null; hook: string | null; hypothesis: boolean };

export type QueueDetail =
  | { kind: "ideas"; ideas: IdeaRow[] }
  /** script préparé pour l'affichage (faits du dossier, compteurs) ; null s'il est illisible */
  | { kind: "script"; videoId: string; review: ScriptContent | null }
  | { kind: "qa"; videoId: string; report: QaReport | null; suggestedReturn: V3ReturnStage }
  | { kind: "fix"; videoId: string; reason: string | null; blockedAt: Stage | null; sources: string[] };

/** Étape où renvoyer la vidéo en V3, d'après l'agent responsable du premier point « ko ». */
export function suggestReturnStage(report: QaReport | null): V3ReturnStage {
  const responsible = report?.controles.find((check) => check.statut === "ko" && check.agent_responsable)?.agent_responsable ?? "";
  if (responsible.startsWith("04")) return "SCRIPT";
  if (responsible.startsWith("05") || responsible.startsWith("06")) return "VISUALS_AND_AUDIO";
  if (responsible.startsWith("08")) return "QA";
  return "EDIT";
}

export async function getValidationData(db: PrismaClient, channelId: string) {
  return { queue: await loadQueue(db, channelId) };
}

export async function getQueueDetail(db: PrismaClient, item: QueueItem): Promise<QueueDetail> {
  const videos = await db.video.findMany({
    where: { id: { in: item.videoIds } },
    select: {
      id: true,
      number: true,
      title: true,
      ideaJson: true,
      scriptJson: true,
      dossierJson: true,
      qaJson: true,
      blockedAt: true,
      blockedReason: true,
      researchSources: true,
      channel: { select: { activeBibleVersionId: true } },
    },
  });
  if (item.gate === "V1") {
    const ideas = videos.map((video): IdeaRow => {
      const idea = parseIdea(video.ideaJson);
      return { videoId: video.id, number: video.number, title: video.title, score: idea?.score ?? null, hook: idea?.accroche ?? null, hypothesis: idea?.hypothese ?? false };
    });
    return { kind: "ideas", ideas: ideas.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) };
  }
  const video = videos[0];
  const videoId = video?.id ?? "";
  if (item.gate === "V2") {
    const target = await loadScriptTarget(db, video?.channel.activeBibleVersionId ?? null);
    return { kind: "script", videoId, review: toScriptContent(video?.scriptJson, video?.dossierJson, target) };
  }
  if (item.gate === "FIX") return { kind: "fix", videoId, reason: video?.blockedReason ?? null, blockedAt: video?.blockedAt ?? null, sources: video?.researchSources ?? [] };
  const report = parseQaReport(video?.qaJson);
  return { kind: "qa", videoId, report, suggestedReturn: suggestReturnStage(report) };
}

export type AgentCard = {
  id: number;
  slug: string;
  name: string;
  role: string;
  state: AgentState;
  lastRunAt: Date | null;
};

export async function getAgentCards(db: PrismaClient, channelId: string): Promise<AgentCard[]> {
  const [agents, stages, lastRuns] = await Promise.all([
    db.agent.findMany({ orderBy: { id: "asc" } }),
    stagesInProgress(db, channelId),
    db.agentRun.groupBy({ by: ["agentId"], _max: { createdAt: true } }),
  ]);
  const lastRunByAgent = new Map(lastRuns.map((run) => [run.agentId, run._max.createdAt]));
  return agents.map((agent) => ({
    id: agent.id,
    slug: agent.slug,
    name: agent.name,
    role: agent.role,
    state: deriveAgentState({ id: parseAgentId(agent.id), active: agent.active }, stages),
    lastRunAt: lastRunByAgent.get(agent.id) ?? null,
  }));
}

export async function getAgentDetail(db: PrismaClient, slug: string) {
  if (!agentCatalog.some((meta) => meta.slug === slug)) return null;
  return db.agent.findUnique({
    where: { slug },
    include: {
      activePromptVersion: true,
      promptVersions: { orderBy: { version: "desc" }, take: 20 },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { video: { select: { number: true, title: true } }, promptVersion: { select: { version: true } } },
      },
    },
  });
}

export async function getBibleData(db: PrismaClient, channelId: string) {
  const channel = await db.channel.findUniqueOrThrow({
    where: { id: channelId },
    include: { activeBibleVersion: true, bibleVersions: { orderBy: { version: "desc" }, take: 30 } },
  });
  return { active: channel.activeBibleVersion, versions: channel.bibleVersions };
}

export type StatRow = {
  publicationId: string;
  videoNumber: number;
  title: string;
  platform: string;
  views: number;
  completionRate: number;
  shares: number;
  followersGained: number;
  date: Date;
};

export async function getStatsData(db: PrismaClient, channelId: string): Promise<{ rows: StatRow[]; report: AnalystReportContent | null; reportDate: Date | null }> {
  const [publications, report] = await Promise.all([
    db.publication.findMany({
      where: { status: "PUBLISHED", video: { channelId } },
      include: { video: { select: { number: true, title: true } }, stats: { orderBy: { date: "desc" }, take: 1 } },
      orderBy: [{ publishedAt: "desc" }, { platform: "asc" }],
    }),
    db.analystReport.findFirst({ where: { channelId }, orderBy: { createdAt: "desc" } }),
  ]);
  const rows = publications.flatMap((publication): StatRow[] => {
    const stat = publication.stats[0];
    if (!stat) return [];
    return [{
      publicationId: publication.id,
      videoNumber: publication.video.number,
      title: publication.video.title,
      platform: platformLabels[publication.platform],
      views: stat.views,
      completionRate: stat.completionRate,
      shares: stat.shares,
      followersGained: stat.followersGained,
      date: stat.date,
    }];
  });
  return { rows, report: report ? parseAnalystReport(report.content) : null, reportDate: report?.createdAt ?? null };
}
