import type { PrismaClient } from "@/lib/generated/prisma/client";
import { ORCHESTRATOR_ID } from "../ports";
import { buildProductionLog, LOG_LIMIT, toBlockedVideoView, toProposalView, type BlockedVideoView, type LogEntryView, type ProposalView } from "./view";

// Lectures du panneau (Server Component). La mise en forme est dans view.ts, testée sans base.

const BLOCKED_LIMIT = 20;
const PROPOSAL_LIMIT = 8;

export type OrchestratorOverview = {
  active: boolean;
  log: LogEntryView[];
  blocked: BlockedVideoView[];
  proposals: ProposalView[];
};

const videoRef = { select: { number: true, title: true } } as const;

async function loadLog(db: PrismaClient, channelId: string): Promise<LogEntryView[]> {
  const [transitions, runs] = await Promise.all([
    db.stageTransition.findMany({
      where: { video: { channelId } },
      orderBy: { createdAt: "desc" },
      take: LOG_LIMIT,
      select: { id: true, createdAt: true, from: true, to: true, event: true, actor: true, video: videoRef },
    }),
    db.agentRun.findMany({
      where: { channelId },
      orderBy: { createdAt: "desc" },
      take: LOG_LIMIT,
      select: { id: true, createdAt: true, agentId: true, status: true, attempt: true, video: videoRef },
    }),
  ]);
  return buildProductionLog(transitions, runs);
}

async function loadBlocked(db: PrismaClient, channelId: string): Promise<BlockedVideoView[]> {
  const videos = await db.video.findMany({
    where: { channelId, stage: "NEEDS_FIX" },
    orderBy: { updatedAt: "desc" },
    take: BLOCKED_LIMIT,
    select: {
      id: true,
      number: true,
      title: true,
      blockedAt: true,
      blockedReason: true,
      transitions: { where: { to: "NEEDS_FIX" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      runs: { where: { agentId: ORCHESTRATOR_ID, status: "OK" }, orderBy: { createdAt: "desc" }, take: 1, select: { output: true, createdAt: true } },
    },
  });
  return videos.map((video) =>
    toBlockedVideoView({
      id: video.id,
      video: { number: video.number, title: video.title },
      blockedAt: video.blockedAt,
      blockedReason: video.blockedReason,
      blockedSince: video.transitions[0]?.createdAt ?? null,
      proposal: video.runs[0] ?? null,
    }),
  );
}

async function loadProposals(db: PrismaClient, channelId: string): Promise<ProposalView[]> {
  const runs = await db.agentRun.findMany({
    where: { channelId, agentId: ORCHESTRATOR_ID, status: "OK" },
    orderBy: { createdAt: "desc" },
    take: PROPOSAL_LIMIT,
    select: { id: true, createdAt: true, output: true, video: videoRef },
  });
  return runs.map(toProposalView).filter((view): view is ProposalView => view !== null);
}

async function loadActive(db: PrismaClient): Promise<boolean> {
  const agent = await db.agent.findUnique({ where: { id: ORCHESTRATOR_ID }, select: { active: true } });
  return agent?.active ?? false;
}

export async function loadOrchestratorOverview(db: PrismaClient, channelId: string): Promise<OrchestratorOverview> {
  const [active, log, blocked, proposals] = await Promise.all([loadActive(db), loadLog(db, channelId), loadBlocked(db, channelId), loadProposals(db, channelId)]);
  return { active, log, blocked, proposals };
}
