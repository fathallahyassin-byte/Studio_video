import type { PrismaClient } from "@/lib/generated/prisma/client";
import { requestAnalysis, requestScout, type PipelineDeps } from "@/lib/pipeline/service";

// Tâches planifiées (CLAUDE.md §8 bis) : chaque lundi, l'analyse à 6 h puis la veille à 7 h.
// Heure locale du serveur (variable TZ sur l'hébergement). Une clé par semaine ISO : un worker
// démarré en milieu de semaine rattrape la tâche manquée, sans jamais la doubler.
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
