import type { AgentJob, PrismaClient } from "@/lib/generated/prisma/client";

// File de tâches dans PostgreSQL (docs/decisions.md). Les tâches sont créées par lib/pipeline,
// dans la même transaction que le changement d'étape ; le worker les prend ici.
// Les dates comparées en SQL utilisent l'horloge de la base en UTC, comme Prisma les stocke.

/** Une tâche « en cours » depuis plus longtemps a perdu son worker (crash, redémarrage). */
export const STALE_AFTER_MS = 30 * 60 * 1000;
/** Au-delà, une tâche qui échoue pour une raison technique passe en échec définitif. */
export const MAX_JOB_ATTEMPTS = 5;

/** Délai avant la relance suivante : 30 s, 1 min, 2 min… plafonné à 1 h. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
}

/**
 * Réserve la prochaine tâche due. FOR UPDATE SKIP LOCKED : deux workers ne prennent jamais la même.
 */
export async function claimNextJob(db: PrismaClient): Promise<AgentJob | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "AgentJob"
    SET "status" = 'RUNNING', "attempts" = "attempts" + 1,
        "lockedAt" = (now() AT TIME ZONE 'UTC'), "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "id" = (
      SELECT "id" FROM "AgentJob"
      WHERE "status" = 'QUEUED' AND "runAfter" <= (now() AT TIME ZONE 'UTC')
      ORDER BY "runAfter", "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  const id = rows[0]?.id;
  return id ? db.agentJob.findUnique({ where: { id } }) : null;
}

export async function completeJob(db: PrismaClient, jobId: string, note?: string): Promise<void> {
  await db.agentJob.update({ where: { id: jobId }, data: { status: "DONE", lockedAt: null, lastError: note ?? null } });
}

export async function retryJob(db: PrismaClient, jobId: string, reason: string, delayMs: number): Promise<void> {
  await db.agentJob.update({
    where: { id: jobId },
    data: { status: "QUEUED", lockedAt: null, lastError: reason, runAfter: new Date(Date.now() + delayMs) },
  });
}

export async function failJob(db: PrismaClient, jobId: string, reason: string): Promise<void> {
  await db.agentJob.update({ where: { id: jobId }, data: { status: "FAILED", lockedAt: null, lastError: reason } });
}

/** Remet en file les tâches « en cours » abandonnées par un worker arrêté. Renvoie leur nombre. */
export async function requeueStaleJobs(db: PrismaClient, olderThanMs = STALE_AFTER_MS): Promise<number> {
  return db.$executeRaw`
    UPDATE "AgentJob"
    SET "status" = 'QUEUED', "lockedAt" = NULL, "lastError" = 'Remise en file : worker interrompu',
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "status" = 'RUNNING'
      AND "lockedAt" < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${olderThanMs / 1000})`;
}
