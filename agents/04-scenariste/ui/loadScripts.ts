import { formatDateTime, formatVideoNumber } from "@/lib/dashboard/format";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import type { ScriptTarget } from "../rules";
import { parseScriptTarget } from "../variables";
import { toScriptView, type ScriptView } from "./scripts";

const RECENT_LIMIT = 20;

export type ScriptOverview = {
  scripts: ScriptView[];
  /** vidéos en cours d'écriture sans script enregistré */
  writing: number;
  unreadable: number;
  /** null quand la bible active manque ou ne donne pas de durée cible */
  target: ScriptTarget | null;
};

/** Cible de la bible active ; null si elle manque ou ne donne pas de durée cible. */
export async function loadScriptTarget(db: PrismaClient, activeBibleVersionId: string | null): Promise<ScriptTarget | null> {
  if (!activeBibleVersionId) return null;
  const bible = await db.bibleVersion.findUnique({ where: { id: activeBibleVersionId }, select: { content: true } });
  if (!bible) return null;
  // Bible incomplète : le panneau s'affiche sans cible plutôt que de planter.
  const parsed = parseScriptTarget(bible.content);
  return parsed.ok ? parsed.target : null;
}

export async function loadScriptOverview(db: PrismaClient, channel: { id: string; activeBibleVersionId: string | null }): Promise<ScriptOverview> {
  const [videos, writing, target] = await Promise.all([
    db.video.findMany({
      where: { channelId: channel.id, scriptJson: { not: Prisma.DbNull } },
      orderBy: { updatedAt: "desc" },
      take: RECENT_LIMIT,
      select: {
        id: true,
        number: true,
        title: true,
        stage: true,
        blockedAt: true,
        updatedAt: true,
        scriptJson: true,
        dossierJson: true,
        validations: { where: { gate: "V2" }, orderBy: { createdAt: "desc" }, take: 1, select: { decision: true, note: true } },
      },
    }),
    db.video.count({ where: { channelId: channel.id, stage: "SCRIPT", scriptJson: { equals: Prisma.DbNull } } }),
    loadScriptTarget(db, channel.activeBibleVersionId),
  ]);
  const views = videos.map((video) =>
    toScriptView(
      {
        id: video.id,
        label: formatVideoNumber(video.number),
        title: video.title,
        stage: video.stage,
        blockedAt: video.blockedAt,
        updatedLabel: formatDateTime(video.updatedAt),
        lastV2Decision: video.validations[0]?.decision ?? null,
        lastV2Note: video.validations[0]?.note ?? null,
        scriptJson: video.scriptJson,
        dossierJson: video.dossierJson,
      },
      target,
    ),
  );
  const scripts = views.filter((view): view is ScriptView => view !== null);
  return { scripts, writing, target, unreadable: views.length - scripts.length };
}
