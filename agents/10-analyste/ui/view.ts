import type { ChipTone } from "@/components/ui";
import { pendingMessage, type AnalysisJob } from "../actionsLogic";
import { formatVideoLabel } from "../metadata";
import { outputSchema, type Output } from "../schema";

// Modèle de vue du panneau de l'analyste : fonctions pures, testées sans base ni React.

export type Confidence = Output["enseignements"][number]["confiance"];
export type ExperimentStatus = "PROPOSED" | "RUNNING" | "DONE" | "ABANDONED";

export type StoredReportRow = { id: string; period: string; createdAt: Date; content: unknown; appliedVersion: number | null };
export type ExperimentRow = { id: string; reportId: string | null; hypothesis: string; variable: string; successCriterion: string; status: ExperimentStatus; startedAt: Date | null };
export type VideoRef = { id: string; number: number; title: string };

export type RankedView = { key: string; label: string; reason: string };
export type LearningView = { key: string; observation: string; decision: string; confidence: Confidence; tone: ChipTone; detail: string };
export type ExperimentView = {
  id: string;
  hypothesis: string;
  variable: string;
  criterion: string;
  statusLabel: string;
  /** « launch » : attend la décision de l'humain (jaune) */
  action: "launch" | "close" | null;
};

export type ReportView = {
  id: string;
  period: string;
  dateLabel: string;
  summary: string;
  top: RankedView[];
  flop: RankedView[];
  learnings: LearningView[];
  verdictLabel: string;
  justification: string;
  bibleUpdates: string[];
  appliedVersion: number | null;
  backlog: { label: string; items: string[] }[];
};

export type StatusView = { message: string; waiting: boolean } | null;

export type PanelView = { report: ReportView | null; unreadableReport: boolean; experiments: ExperimentView[]; status: StatusView; hasActiveBible: boolean };

export const confidenceLabels: Record<Confidence, string> = { faible: "Confiance faible", moyenne: "Confiance moyenne", forte: "Confiance forte" };
const confidenceTones: Record<Confidence, ChipTone> = { faible: "run", moyenne: "run", forte: "ok" };
const verdictLabels: Record<Output["verdict_niche"], string> = { continuer: "Continuer", ajuster: "Ajuster", pivoter: "Pivoter" };
const statusLabels: Record<ExperimentStatus, string> = { PROPOSED: "À lancer", RUNNING: "En cours", DONE: "Close", ABANDONED: "Abandonnée" };

const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export type PanelInput = {
  report: StoredReportRow | null;
  videos: readonly VideoRef[];
  experiments: readonly ExperimentRow[];
  job: AnalysisJob | null;
  hasActiveBible: boolean;
};

export function buildPanelView(input: PanelInput): PanelView {
  const parsed = input.report ? outputSchema.safeParse(input.report.content) : null;
  const report = input.report && parsed?.success ? buildReportView(input.report, parsed.data, input.videos) : null;
  return {
    report,
    unreadableReport: parsed !== null && !parsed.success,
    experiments: visibleExperiments(input.experiments, input.report?.id ?? null).map(buildExperimentView),
    status: buildStatus(input.job),
    hasActiveBible: input.hasActiveBible,
  };
}

export function buildReportView(row: StoredReportRow, content: Output, videos: readonly VideoRef[]): ReportView {
  const byId = new Map(videos.map((video) => [video.id, video]));
  const ranked = (entries: Output["top"]) =>
    entries.map((entry, position) => ({ key: `${position}-${entry.video_id}`, label: videoLabel(byId.get(entry.video_id), entry.video_id), reason: entry.pourquoi }));
  return {
    id: row.id,
    period: row.period,
    dateLabel: dateFormat.format(row.createdAt),
    summary: content.resume,
    top: ranked(content.top),
    flop: ranked(content.flop),
    learnings: content.enseignements.map((learning, position) => ({
      key: `${position}`,
      observation: learning.observation,
      decision: learning.decision,
      confidence: learning.confiance,
      tone: confidenceTones[learning.confiance],
      detail: `${confidenceLabels[learning.confiance]} · ${learning.nb_videos} vidéo${learning.nb_videos > 1 ? "s" : ""}`,
    })),
    verdictLabel: verdictLabels[content.verdict_niche],
    justification: content.justification,
    bibleUpdates: content.maj_bible,
    appliedVersion: row.appliedVersion,
    backlog: [
      { label: "À prioriser", items: content.maj_backlog.prioriser },
      { label: "À abandonner", items: content.maj_backlog.abandonner },
      { label: "À décliner en série", items: content.maj_backlog.series },
    ].filter((group) => group.items.length > 0),
  };
}

export function videoLabel(video: VideoRef | undefined, fallbackId: string): string {
  return video ? `${formatVideoLabel(video.number)} · ${video.title}` : `Vidéo inconnue (${fallbackId})`;
}

/** Les expériences du dernier rapport, plus toutes celles en cours (même d'un rapport plus ancien). */
export function visibleExperiments(experiments: readonly ExperimentRow[], reportId: string | null): ExperimentRow[] {
  return experiments.filter((experiment) => experiment.status === "RUNNING" || (reportId !== null && experiment.reportId === reportId));
}

function buildExperimentView(row: ExperimentRow): ExperimentView {
  const started = row.status === "RUNNING" && row.startedAt ? ` depuis le ${dateFormat.format(row.startedAt)}` : "";
  return {
    id: row.id,
    hypothesis: row.hypothesis,
    variable: row.variable,
    criterion: row.successCriterion,
    statusLabel: `${statusLabels[row.status]}${started}`,
    action: row.status === "PROPOSED" ? "launch" : row.status === "RUNNING" ? "close" : null,
  };
}

/** État de la tâche d'analyse de la semaine : en file, en cours ou en attente de données. */
export function buildStatus(job: AnalysisJob | null): StatusView {
  if (!job || (job.status === "DONE" && job.lastError === null)) return null;
  // DONE avec une note : 3 sorties refusées, aucun rapport (runAgent a prévenu l'humain).
  if (job.status === "DONE") return { message: `La dernière analyse n'a pas produit de rapport : ${job.lastError}`, waiting: true };
  if (job.status === "FAILED") return { message: `La dernière analyse a échoué : ${job.lastError ?? "raison inconnue"}`, waiting: true };
  return { message: pendingMessage(job), waiting: job.lastError !== null };
}
