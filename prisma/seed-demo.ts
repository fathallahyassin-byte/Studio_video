// Données de démonstration pour voir les écrans remplis : `npm run db:seed:demo` (après `npm run db:seed`).
// Refuse de tourner si la base contient déjà des vidéos. Pour repartir de zéro : `npx prisma migrate reset`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { renderTemplate } from "@/lib/agents/template";
import { getDb } from "@/lib/db";
import { buildDemoReport, buildDemoVideos, demoBibleValues, demoStats, type DemoVideo } from "@/lib/demo/demoData";
import type { Gate, PrismaClient, Stage } from "@/lib/generated/prisma/client";
import { toInputJson } from "@/lib/json";

loadEnvConfig(process.cwd());

const MINUTE = 60_000;
const DECIDED_BY = "démo";

/** Validations déjà passées pour arriver à cette étape. */
function gatesPassed(stage: Stage): Gate[] {
  const order: Stage[] = ["RESEARCH", "SCRIPT", "AWAITING_V2", "VISUALS_AND_AUDIO", "EDIT", "RENDER", "QA", "AWAITING_V3", "SCHEDULED", "PUBLISHED"];
  const index = order.indexOf(stage);
  if (index < 0) return [];
  if (index < order.indexOf("VISUALS_AND_AUDIO")) return ["V1"];
  if (index < order.indexOf("SCHEDULED")) return ["V1", "V2"];
  return ["V1", "V2", "V3"];
}

async function activePromptVersionId(db: PrismaClient, agentId: number): Promise<string> {
  const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId }, select: { activePromptVersionId: true } });
  if (!agent.activePromptVersionId) throw new Error(`Agent ${agentId} sans prompt actif : lance d'abord npm run db:seed.`);
  return agent.activePromptVersionId;
}

async function ensureBible(db: PrismaClient, channelId: string): Promise<string> {
  const channel = await db.channel.findUniqueOrThrow({ where: { id: channelId } });
  if (channel.activeBibleVersionId) return channel.activeBibleVersionId;
  const template = readFileSync(path.join(process.cwd(), "docs", "bible.template.yaml"), "utf8");
  const last = await db.bibleVersion.findFirst({ where: { channelId }, orderBy: { version: "desc" } });
  const bible = await db.bibleVersion.create({
    data: { channelId, version: (last?.version ?? 0) + 1, content: renderTemplate(template, demoBibleValues), author: "HUMAN", note: "Bible de démonstration" },
  });
  await db.channel.update({ where: { id: channelId }, data: { activeBibleVersionId: bible.id, niche: demoBibleValues.NICHE ?? channel.niche } });
  return bible.id;
}

async function createVideo(db: PrismaClient, channelId: string, demo: DemoVideo, now: number) {
  const at = new Date(now - demo.minutesAgo * MINUTE);
  const video = await db.video.create({
    data: {
      channelId,
      title: demo.title,
      stage: demo.stage,
      blockedAt: demo.blockedAt ?? null,
      blockedReason: demo.blockedReason ?? null,
      ideaJson: toInputJson(demo.idea),
      ...(demo.script ? { scriptJson: toInputJson(demo.script) } : {}),
      ...(demo.qa ? { qaJson: toInputJson(demo.qa) } : {}),
      createdAt: new Date(at.getTime() - 3 * 24 * 60 * MINUTE),
      updatedAt: at,
    },
  });
  for (const gate of gatesPassed(demo.stage)) {
    await db.validation.create({ data: { videoId: video.id, gate, decision: "APPROVED", decidedBy: DECIDED_BY, createdAt: at } });
  }
  return { video, at };
}

async function createPublications(db: PrismaClient, videoId: string, kind: "scheduled" | "published", at: Date, now: number) {
  for (const stat of demoStats) {
    const publication = await db.publication.create({
      data: {
        videoId,
        platform: stat.platform,
        status: kind === "published" ? "PUBLISHED" : "SCHEDULED",
        scheduledFor: kind === "published" ? at : new Date(now + 20 * 60 * MINUTE),
        publishedAt: kind === "published" ? at : null,
        aiLabel: true,
      },
    });
    if (kind === "published") {
      await db.stat.create({
        data: {
          publicationId: publication.id,
          date: new Date(now - 24 * 60 * MINUTE),
          views: stat.views,
          avgWatchTimeS: stat.avgWatchTimeS,
          completionRate: stat.completionRate,
          shares: stat.shares,
          saves: stat.saves,
          followersGained: stat.followersGained,
        },
      });
    }
  }
}

async function createRun(
  db: PrismaClient,
  run: { channelId: string; videoId: string | null; agentId: number; jobKey: string; attempt: number; output: unknown; at: Date; bibleVersionId: string; cost: number; error?: string },
) {
  const ok = run.error === undefined;
  return db.agentRun.create({
    data: {
      jobKey: run.jobKey,
      attempt: run.attempt,
      channelId: run.channelId,
      videoId: run.videoId,
      agentId: run.agentId,
      promptVersionId: await activePromptVersionId(db, run.agentId),
      bibleVersionId: run.bibleVersionId,
      model: "[modèle de démo]",
      input: {},
      output: ok ? toInputJson(run.output) : undefined,
      rawOutput: ok ? JSON.stringify(run.output) : "Voici le script demandé : …",
      status: ok ? "OK" : "INVALID_JSON",
      error: run.error ?? null,
      inputTokens: 6_200,
      outputTokens: 1_400,
      cost: run.cost,
      durationMs: 21_000,
      successHandledAt: ok ? run.at : null,
      createdAt: run.at,
    },
  });
}

async function main(): Promise<void> {
  const db = getDb();
  try {
    const channel = await db.channel.findFirst({ orderBy: { createdAt: "asc" } });
    if (!channel) throw new Error("Aucune chaîne : lance d'abord npm run db:seed.");
    if ((await db.video.count()) > 0) throw new Error("La base contient déjà des vidéos : la démo ne s'ajoute qu'à une base vide.");

    const now = Date.now();
    const bibleVersionId = await ensureBible(db, channel.id);
    const created = new Map<string, { id: string; at: Date }>();
    for (const demo of buildDemoVideos()) {
      const { video, at } = await createVideo(db, channel.id, demo, now);
      created.set(demo.key, { id: video.id, at });
      if (demo.publication) await createPublications(db, video.id, demo.publication, at, now);
    }

    const base = { channelId: channel.id, bibleVersionId };
    const ideasAt = new Date(now - 120 * MINUTE);
    await createRun(db, { ...base, videoId: null, agentId: 2, jobKey: "demo:veille:2026-W47", attempt: 1, output: { demo: true }, at: ideasAt, cost: 0.06 });
    for (const demo of buildDemoVideos()) {
      const video = created.get(demo.key);
      if (!video) continue;
      if (demo.script) {
        const jobKey = `demo:${video.id}:SCRIPT:4`;
        if (demo.key === "crayons") {
          await createRun(db, { ...base, videoId: video.id, agentId: 4, jobKey, attempt: 1, output: null, at: new Date(video.at.getTime() - MINUTE), cost: 0.03, error: "La réponse ne contient pas de JSON lisible." });
        }
        await createRun(db, { ...base, videoId: video.id, agentId: 4, jobKey, attempt: demo.key === "crayons" ? 2 : 1, output: demo.script, at: video.at, cost: 0.03 });
      }
      if (demo.qa) await createRun(db, { ...base, videoId: video.id, agentId: 8, jobKey: `demo:${video.id}:QA:8`, attempt: 1, output: demo.qa, at: video.at, cost: 0.05 });
    }
    await db.$executeRaw`UPDATE "Video" v SET "totalCost" = COALESCE((SELECT SUM(r."cost") FROM "AgentRun" r WHERE r."videoId" = v."id"), 0)`;

    const published = created.get("conserve");
    if (published) {
      const report = buildDemoReport(published.id);
      const run = await createRun(db, { ...base, videoId: null, agentId: 10, jobKey: "demo:analyse:2026-W46", attempt: 1, output: report, at: new Date(now - 26 * 60 * MINUTE), cost: 0.08 });
      await db.analystReport.create({ data: { channelId: channel.id, agentRunId: run.id, period: report.periode, content: toInputJson(report), createdAt: run.createdAt } });
    }
    console.log(`Démo créée : ${created.size} vidéos, une bible, des statistiques et un rapport d'analyste.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
