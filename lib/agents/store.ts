import type { AgentId } from "@/agents/_shared/types";

// Accès aux données dont runAgent a besoin. Deux implémentations : Prisma (prismaStore.ts)
// et mémoire (memoryStore.ts, pour les tests et les evals).

export type RunStatus = "OK" | "INVALID_JSON" | "CONTROL_FAILED" | "ERROR";

export type AgentConfig = {
  id: AgentId;
  slug: string;
  name: string;
  model: string;
  active: boolean;
  promptVersion: { id: string; content: string } | null;
};

export type BibleSnapshot = {
  id: string;
  content: string;
};

export type StoredAttempt = {
  id: string;
  attempt: number;
  status: RunStatus;
  rawOutput: string | null;
  error: string | null;
  output: unknown;
  bibleVersionId: string | null;
  successHandledAt: Date | null;
};

export type AttemptRecord = {
  jobKey: string;
  attempt: number;
  channelId: string;
  videoId: string | null;
  agentId: AgentId;
  promptVersionId: string;
  bibleVersionId: string | null;
  model: string;
  input: Record<string, string>;
  output: unknown;
  rawOutput: string | null;
  status: RunStatus;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  durationMs: number;
};

export type AgentRunStore = {
  loadAgent(agentId: AgentId): Promise<AgentConfig | null>;
  loadActiveBible(channelId: string): Promise<BibleSnapshot | null>;
  loadBible(bibleVersionId: string): Promise<BibleSnapshot | null>;
  /** tentatives déjà enregistrées pour cette clé, par numéro croissant */
  listAttempts(jobKey: string): Promise<StoredAttempt[]>;
  /** enregistre la tentative et ajoute son coût à la vidéo */
  recordAttempt(record: AttemptRecord): Promise<{ id: string }>;
  markSuccessHandled(runId: string): Promise<void>;
  /** passe la vidéo en NEEDS_FIX en gardant l'étape à reprendre ; idempotent */
  markNeedsFix(videoId: string, reason: string): Promise<void>;
};
