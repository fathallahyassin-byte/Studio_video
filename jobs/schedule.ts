import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import { requestAnalysis, requestScout, type PipelineDeps } from "@/lib/pipeline/service";

// Tâches planifiées (CLAUDE.md §8 bis) : chaque lundi, l'analyse à 6 h puis la veille à 7 h.
// Heure locale du serveur (variable TZ sur l'hébergement). Une clé par semaine ISO : un worker
// démarré en milieu de semaine rattrape la tâche manquée, sans jamais la doubler.
// Chaque mois, le 1er à 9 h : un rappel (notification, pas de tâche) de relancer l'analyse des niches (agent 1).
// L'import quotidien des statistiques viendra avec les API des plateformes (étape 8).

export type WeeklyTask = { name: "analyse" | "veille"; hour: number };

export const WEEKLY_TASKS: readonly WeeklyTask[] = [
  { name: "analyse", hour: 6 },
  { name: "veille", hour: 7 },
];

/** Vrai si l'heure de la tâche est passée dans la semaine en cours (lundi = début de semaine). */
export function isDueThisWeek(task: WeeklyTask, now: Date): boolean {
  const weekday = now.getDay() === 0 ? 7 : now.getDay();
  return weekday > 1 || now.getHours() >= task.hour;
}

export async function enqueueDueTasks(deps: PipelineDeps, now: Date): Promise<string[]> {
  const channels = await listChannels(deps.db);
  const queued: string[] = [];
  for (const task of WEEKLY_TASKS.filter((candidate) => isDueThisWeek(candidate, now))) {
    for (const channelId of channels) {
      const result = task.name === "analyse" ? await requestAnalysis(deps, channelId, now) : await requestScout(deps, channelId, now);
      if (result.queued) queued.push(`${task.name} ${result.week}`);
    }
  }
  return queued;
}

async function listChannels(db: PrismaClient): Promise<string[]> {
  const channels = await db.channel.findMany({ select: { id: true } });
  return channels.map((channel) => channel.id);
}

// ---------------------------------------------------------------------------
// Rappel mensuel du stratège de niche (agent 1).
// Pas de tâche automatique : le formulaire (pistes, temps, budget, objectif) est relu par l'humain.
// ---------------------------------------------------------------------------

export const STRATEGY_REMINDER_HOUR = 9;
export const STRATEGY_PATH = "/agents/01-strategiste-niche";

/** Vrai si l'heure du rappel est passée dans le mois en cours (rattrapé jusqu'à la fin du mois). */
export function isDueThisMonth(hour: number, now: Date): boolean {
  return now.getDate() > 1 || now.getHours() >= hour;
}

/** « 2026-12 », en heure locale du serveur comme le planning. */
export function monthKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Rappels dus, au plus un par chaîne et par mois. Renvoie ce qui a été envoyé (journal du worker). */
export async function sendDueReminders(deps: PipelineDeps, now: Date): Promise<string[]> {
  if (!isDueThisMonth(STRATEGY_REMINDER_HOUR, now)) return [];
  const sent: string[] = [];
  for (const channelId of await listChannels(deps.db)) {
    if (await remindStrategy(deps, channelId, now)) sent.push(`rappel stratégie ${monthKey(now)}`);
  }
  return sent;
}

/**
 * Rien si l'agent 1 est désactivé ou si une analyse a déjà été lancée ce mois-ci.
 * La ligne Reminder est écrite avant l'envoi : un redémarrage ne renvoie jamais le rappel.
 */
async function remindStrategy(deps: PipelineDeps, channelId: string, now: Date): Promise<boolean> {
  const agent = await deps.db.agent.findUnique({ where: { id: 1 }, select: { active: true } });
  if (!agent?.active) return false;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const launched = await deps.db.agentJob.count({ where: { channelId, agentId: 1, createdAt: { gte: monthStart } } });
  if (launched > 0) return false;
  if (!(await recordReminder(deps.db, `strategie:${channelId}:${monthKey(now)}`, channelId))) return false;
  await deps.notifier.notify({
    kind: "reminder",
    title: "Analyse des niches du mois",
    message: "Relance l'analyse des niches : le formulaire reprend tes dernières réponses.",
    path: STRATEGY_PATH,
  });
  return true;
}

/** false si le rappel a déjà été envoyé (clé unique). */
async function recordReminder(db: PrismaClient, key: string, channelId: string): Promise<boolean> {
  try {
    await db.reminder.create({ data: { key, channelId } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}
