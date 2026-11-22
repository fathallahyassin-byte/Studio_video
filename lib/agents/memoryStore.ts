import type { AgentId } from "@/agents/_shared/types";
import type { AgentConfig, AgentRunStore, AttemptRecord, BibleSnapshot, StoredAttempt } from "./store";

type MemoryRun = AttemptRecord & { id: string; successHandledAt: Date | null };

export type MemoryRunStore = AgentRunStore & {
  readonly runs: MemoryRun[];
  readonly needsFix: Map<string, string>;
  readonly videoCosts: Map<string, number>;
  setAgent(agent: AgentConfig): void;
  setActiveBible(channelId: string, bible: BibleSnapshot): void;
};

/** Store en mémoire, pour les tests et les evals. */
export function createMemoryRunStore(): MemoryRunStore {
  const agents = new Map<AgentId, AgentConfig>();
  const bibles = new Map<string, BibleSnapshot>();
  const activeBibles = new Map<string, string>();
  const runs: MemoryRun[] = [];
  const needsFix = new Map<string, string>();
  const videoCosts = new Map<string, number>();

  return {
    runs,
    needsFix,
    videoCosts,
    setAgent(agent) {
      agents.set(agent.id, agent);
    },
    setActiveBible(channelId, bible) {
      bibles.set(bible.id, bible);
      activeBibles.set(channelId, bible.id);
    },
    async loadAgent(agentId) {
      return agents.get(agentId) ?? null;
    },
    async loadActiveBible(channelId) {
      const id = activeBibles.get(channelId);
      return id === undefined ? null : (bibles.get(id) ?? null);
    },
    async loadBible(bibleVersionId) {
      return bibles.get(bibleVersionId) ?? null;
    },
    async listAttempts(jobKey) {
      return runs
        .filter((run) => run.jobKey === jobKey)
        .sort((a, b) => a.attempt - b.attempt)
        .map((run): StoredAttempt => ({
          id: run.id,
          attempt: run.attempt,
          status: run.status,
          rawOutput: run.rawOutput,
          error: run.error,
          output: run.output,
          bibleVersionId: run.bibleVersionId,
          successHandledAt: run.successHandledAt,
        }));
    },
    async recordAttempt(record) {
      if (runs.some((run) => run.jobKey === record.jobKey && run.attempt === record.attempt)) {
        throw new Error(`Tentative ${record.attempt} déjà enregistrée pour ${record.jobKey}`);
      }
      const run: MemoryRun = { ...record, id: `run-${runs.length + 1}`, successHandledAt: null };
      runs.push(run);
      if (record.videoId) videoCosts.set(record.videoId, (videoCosts.get(record.videoId) ?? 0) + record.cost);
      return { id: run.id };
    },
    async markSuccessHandled(runId) {
      const run = runs.find((candidate) => candidate.id === runId);
      if (run) run.successHandledAt = new Date();
    },
    async markNeedsFix(videoId, reason) {
      needsFix.set(videoId, reason);
    },
  };
}
