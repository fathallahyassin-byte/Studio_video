import { appendLearnings } from "./bibleText";
import { outputSchema } from "./schema";

// Commandes de l'humain sur la page de l'analyste, indépendantes de Next.js et de Prisma (testées avec des faux).

export type ActionResult = { ok: boolean; message: string };

export type StoredReport = {
  id: string;
  channelId: string;
  period: string;
  content: unknown;
  appliedVersion: number | null;
};

export type BibleCreation = { status: "created"; version: number } | { status: "already_applied"; version: number | null };

export type ActiveBible = { id: string; version: number; content: string };

export type AnalysisJob = { status: "QUEUED" | "RUNNING" | "DONE" | "FAILED"; lastError: string | null; runAfter: Date };

export type HumanPorts = {
  loadReport(reportId: string): Promise<StoredReport | null>;
  loadActiveBible(channelId: string): Promise<ActiveBible | null>;
  /**
   * Nouvelle BibleVersion (auteur agent 10), adoptée comme bible active, et rapport marqué appliqué, dans
   * une transaction. « already_applied » si le rapport l'a déjà été (double clic, deux onglets).
   */
  createBibleFromReport(input: { reportId: string; channelId: string; content: string; note: string }): Promise<BibleCreation>;
  /** PROPOSED → RUNNING ; false si l'expérience n'est plus proposée */
  startExperiment(experimentId: string, channelId: string, now: Date): Promise<boolean>;
  /** RUNNING → DONE ; false si elle n'est pas en cours */
  finishExperiment(experimentId: string, channelId: string, now: Date): Promise<boolean>;
  /** tâche hebdomadaire partagée avec le planning du lundi (requestAnalysis) */
  queueWeeklyAnalysis(channelId: string, now: Date): Promise<{ queued: boolean; week: string }>;
  /** dernière tâche d'analyse de la semaine (planning ou relance) */
  loadWeekJob(channelId: string, week: string): Promise<AnalysisJob | null>;
  /** relance manuelle après une analyse terminée ; false si une autre relance vient d'être créée */
  queueRerun(channelId: string, week: string): Promise<boolean>;
};

const bibleUpdatesSchema = outputSchema.pick({ maj_bible: true });

const learningsOf = (content: unknown): string[] => {
  const parsed = bibleUpdatesSchema.safeParse(content);
  return parsed.success ? parsed.data.maj_bible : [];
};

/** Lignes cochées parmi les apprentissages proposés (indices hors liste ignorés). */
export function pickLearnings(content: unknown, selected: readonly number[]): string[] {
  const lines = learningsOf(content);
  return [...new Set(selected)].sort((a, b) => a - b).flatMap((index) => (lines[index] === undefined ? [] : [lines[index]]));
}

/**
 * « Appliquer à la bible » : ajoute les apprentissages cochés à une NOUVELLE version de la bible active, qui devient
 * la bible active. Aucune version existante n'est modifiée. Idempotent : un rapport ne s'applique qu'une fois.
 */
export async function applyReportToBible(ports: HumanPorts, input: { reportId: string; channelId: string; selected: readonly number[] }): Promise<ActionResult> {
  const report = await ports.loadReport(input.reportId);
  if (!report || report.channelId !== input.channelId) return { ok: false, message: "Rapport introuvable." };
  if (report.appliedVersion !== null) return alreadyApplied(report.appliedVersion);
  const lines = pickLearnings(report.content, input.selected);
  if (lines.length === 0) return { ok: false, message: "Coche au moins un apprentissage à ajouter." };

  const bible = await ports.loadActiveBible(input.channelId);
  if (!bible) return { ok: false, message: "Aucune bible active : crée-la depuis l'écran Bible." };
  const appended = appendLearnings(bible.content, lines, report.period);
  if (!appended.ok) return { ok: false, message: appended.error };
  if (appended.added.length === 0) return { ok: false, message: `Ces apprentissages sont déjà dans la bible v${bible.version} : rien à ajouter.` };

  const note = `Apprentissages de l'analyste (${report.period}), ajoutés à la v${bible.version}`;
  const created = await ports.createBibleFromReport({ reportId: report.id, channelId: input.channelId, content: appended.content, note });
  if (created.status === "already_applied") return alreadyApplied(created.version);
  return { ok: true, message: `Bible v${created.version} créée avec ${appended.added.length} apprentissage(s) et adoptée. La v${bible.version} reste dans l'historique.` };
}

function alreadyApplied(version: number | null): ActionResult {
  return { ok: true, message: `Déjà appliqué${version === null ? "" : ` : bible v${version}`}.` };
}

export async function launchExperiment(ports: HumanPorts, input: { experimentId: string; channelId: string; now: Date }): Promise<ActionResult> {
  const started = await ports.startExperiment(input.experimentId, input.channelId, input.now);
  return started ? { ok: true, message: "Expérience lancée." } : { ok: false, message: "Cette expérience n'est plus à lancer (déjà lancée ou close)." };
}

export async function closeExperiment(ports: HumanPorts, input: { experimentId: string; channelId: string; now: Date }): Promise<ActionResult> {
  const finished = await ports.finishExperiment(input.experimentId, input.channelId, input.now);
  return finished ? { ok: true, message: "Expérience close." } : { ok: false, message: "Cette expérience n'est pas en cours." };
}

const timeFormat = new Intl.DateTimeFormat("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" });

/**
 * « Lancer l'analyse » : la tâche de la semaine si elle n'existe pas encore, sinon une relance quand la précédente
 * est terminée. Jamais deux analyses en file en même temps.
 */
export async function launchAnalysis(ports: HumanPorts, input: { channelId: string; now: Date }): Promise<ActionResult> {
  const weekly = await ports.queueWeeklyAnalysis(input.channelId, input.now);
  if (weekly.queued) return { ok: true, message: `Analyse ${weekly.week} en file : le worker la lance dans la minute.` };
  const job = await ports.loadWeekJob(input.channelId, weekly.week);
  if (job && (job.status === "QUEUED" || job.status === "RUNNING")) return { ok: true, message: pendingMessage(job) };
  const queued = await ports.queueRerun(input.channelId, weekly.week);
  return queued ? { ok: true, message: `Nouvelle analyse ${weekly.week} en file.` } : { ok: false, message: "Une relance vient déjà d'être demandée." };
}

export function pendingMessage(job: AnalysisJob): string {
  if (job.status === "RUNNING") return "L'analyse de la semaine est en cours.";
  const next = `prochaine tentative ${timeFormat.format(job.runAfter)}`;
  return job.lastError ? `Analyse de la semaine en attente (${next}) : ${job.lastError}` : `Analyse de la semaine déjà en file (${next}).`;
}
