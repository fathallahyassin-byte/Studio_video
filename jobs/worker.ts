// Worker : `npm run worker`. Tourne en continu (pas en serverless) et prend les tâches dans PostgreSQL.
// Arrêt propre sur Ctrl+C / SIGTERM : la tâche en cours se termine avant la sortie.
import { loadEnvConfig } from "@next/env";
import { getDb } from "@/lib/db";
import { claimNextJob, requeueStaleJobs } from "@/lib/queue/queue";
import { getConfiguredLlmProvider } from "@/lib/providers/llmConfig";
import { getNotifier } from "@/lib/providers/notify";
import { getRenderProvider } from "@/lib/render/localRenderer";
import { processNextJob, type JobDeps } from "./handlers";
import { enqueueDueTasks } from "./schedule";

loadEnvConfig(process.cwd());

const POLL_MS = Number(process.env.WORKER_POLL_MS) > 0 ? Number(process.env.WORKER_POLL_MS) : 5000;
const HOUSEKEEPING_MS = 60_000;

let stopping = false;
let wake: (() => void) | null = null;

function stop(): void {
  if (stopping) return;
  stopping = true;
  console.log("[worker] arrêt demandé : fin de la tâche en cours…");
  wake?.();
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function housekeeping(deps: JobDeps): Promise<void> {
  const requeued = await requeueStaleJobs(deps.db);
  if (requeued > 0) console.log(`[worker] ${requeued} tâche(s) abandonnée(s) remise(s) en file`);
  const planned = await enqueueDueTasks(deps, new Date());
  if (planned.length > 0) console.log(`[worker] planifié : ${planned.join(", ")}`);
}

async function main(): Promise<void> {
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const deps: JobDeps = { db: getDb(), notifier: getNotifier(), llm: getConfiguredLlmProvider(), renderer: getRenderProvider() };
  const warnings = [deps.llm ? null : "aucun fournisseur LLM : les tâches d'agents restent en file", deps.renderer ? null : "stockage S3 non configuré : les rendus attendent"];
  console.log(`[worker] démarré (scrutation toutes les ${POLL_MS} ms)${warnings.filter((warning) => warning !== null).map((warning) => ` — ${warning}`).join("")}`);

  let lastHousekeeping = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastHousekeeping >= HOUSEKEEPING_MS) {
        await housekeeping(deps);
        lastHousekeeping = Date.now();
      }
      const worked = await processNextJob(deps, claimNextJob);
      if (!worked) await pause(POLL_MS);
    } catch (error) {
      console.error("[worker] erreur de boucle", error);
      await pause(POLL_MS);
    }
  }
  await deps.db.$disconnect();
  console.log("[worker] arrêté");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
