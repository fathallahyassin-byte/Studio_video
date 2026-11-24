import type { PrismaClient } from "@/lib/generated/prisma/client";
import { ORCHESTRATOR_ID } from "./ports";

// Interrupteur Activé / Désactivé de l'orchestrateur (Agent.active de l'agent 0, désactivé par défaut).

export type ActivationPorts = {
  /** false si l'agent 0 est absent de la base */
  setActive(active: boolean): Promise<boolean>;
  /** tâches de l'agent 0 encore en file : annulées pour qu'aucune ne tourne une fois désactivé */
  cancelQueuedJobs(): Promise<number>;
};

export type ActivationResult = { ok: boolean; message: string };

export const CANCELLED_REASON = "Annulée : orchestrateur désactivé.";

export async function switchOrchestrator(ports: ActivationPorts, active: boolean): Promise<ActivationResult> {
  if (!(await ports.setActive(active))) return { ok: false, message: "Orchestrateur absent de la base : lance npm run db:seed." };
  if (active) return { ok: true, message: "Orchestrateur activé : il propose, la machine à états décide, et les validations restent à toi." };
  const cancelled = await ports.cancelQueuedJobs();
  const detail = cancelled > 0 ? ` ${cancelled} tâche(s) en file annulée(s).` : "";
  return { ok: true, message: `Orchestrateur désactivé : la machine à états pilote seule.${detail}` };
}

export function createPrismaActivationPorts(db: PrismaClient): ActivationPorts {
  return {
    async setActive(active) {
      const updated = await db.agent.updateMany({ where: { id: ORCHESTRATOR_ID }, data: { active } });
      return updated.count === 1;
    },
    async cancelQueuedJobs() {
      const cancelled = await db.agentJob.updateMany({
        where: { agentId: ORCHESTRATOR_ID, status: "QUEUED" },
        data: { status: "FAILED", lastError: CANCELLED_REASON },
      });
      return cancelled.count;
    },
  };
}
