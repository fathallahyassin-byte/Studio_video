import type { ChipTone } from "@/components/ui";
import { qaCheckLabel, qaDecisionLabels, qaStatusLabels } from "@/lib/dashboard/qaChecklist";
import type { Stage } from "@/lib/generated/prisma/client";
import { stageLabels } from "@/lib/pipeline/machine";
import { CHECK_GROUPS, CHECK_IDS, groupLabels, groupOf, type Check, type CheckGroup, type Decision } from "../checklist";
import { UNVERIFIED_PREFIX } from "../rules";
import type { Output } from "../schema";
import { parseStoredReport } from "../variables";

// Modèle de vue du panneau : données sérialisables, calculées côté serveur (fonctions pures).

export type ReportRow = {
  id: string;
  label: string;
  title: string;
  stage: Stage;
  blockedAt: Stage | null;
  updatedLabel: string;
  qaJson: unknown;
  /** url du dernier rendu (Asset RENDER), null s'il n'y en a pas */
  renderUrl: string | null;
};

/** `notice` non nul : la vidéo attend une action de l'humain (seul cas affiché en jaune). */
export type ReportStatus = { label: string; tone: ChipTone; notice: string | null };

export type CheckView = {
  id: string;
  label: string;
  statut: Check["statut"];
  statusLabel: string;
  tone: ChipTone;
  preuve: string;
  correction: string | null;
  agent: string | null;
  /** point forcé en « ko » faute de source (préfixe « NON VÉRIFIÉ ») */
  unverified: boolean;
};

export type GroupView = { group: CheckGroup; title: string; checks: CheckView[] };

export type LabelView = { name: string; on: boolean };

export type ReportView = {
  videoId: string;
  label: string;
  title: string;
  updatedLabel: string;
  status: ReportStatus;
  decision: Decision;
  decisionLabel: string;
  decisionTone: ChipTone;
  summary: string;
  groups: GroupView[];
  /** points de la check-list absents du rapport (rapports anciens ou de démonstration) */
  missingChecks: string[];
  koCount: number;
  labels: LabelView[];
  mentions: string[];
  renderHref: string | null;
};

export function describeStatus(row: Pick<ReportRow, "stage" | "blockedAt">): ReportStatus {
  if (row.stage === "AWAITING_V3") return { label: "À valider (V3)", tone: "wait", notice: "Ce rapport attend ton GO final (V3)." };
  if (row.stage === "NEEDS_FIX" && row.blockedAt === "QA") return { label: "Bloquée : à corriger", tone: "wait", notice: "NO-GO : la vidéo est bloquée et attend ta décision." };
  if (row.stage === "QA") return { label: "Nouveau contrôle en cours", tone: "run", notice: null };
  if (row.stage === "REJECTED") return { label: "Abandonnée", tone: "run", notice: null };
  return { label: stageLabels[row.stage], tone: row.stage === "PUBLISHED" ? "ok" : "run", notice: null };
}

function toCheckView(check: Check, awaiting: boolean): CheckView {
  const tone: ChipTone = check.statut === "ok" ? "ok" : check.statut === "ko" && awaiting ? "wait" : "run";
  return {
    id: check.id,
    label: qaCheckLabel(check.id),
    statut: check.statut,
    statusLabel: qaStatusLabels[check.statut],
    tone,
    preuve: check.preuve,
    correction: check.correction?.trim() || null,
    agent: check.agent_responsable?.trim() || null,
    unverified: check.preuve.startsWith(UNVERIFIED_PREFIX),
  };
}

/** Points rangés de A à F, dans l'ordre de la check-list ; un id inconnu va à la fin de son groupe. */
export function toGroupViews(checks: readonly Check[], awaiting: boolean): GroupView[] {
  const order = (id: string) => {
    const index = CHECK_IDS.findIndex((known) => known === id);
    return index === -1 ? CHECK_IDS.length : index;
  };
  return CHECK_GROUPS.map((group) => ({
    group,
    title: `${group}. ${groupLabels[group]}`,
    checks: checks
      .filter((check) => groupOf(check.id) === group)
      .sort((a, b) => order(a.id) - order(b.id))
      .map((check) => toCheckView(check, awaiting)),
  })).filter((group) => group.checks.length > 0);
}

export function toLabelViews(etiquettes: Output["etiquettes"]): LabelView[] {
  return [
    { name: "TikTok : contenu généré par IA", on: etiquettes.tiktok_contenu_ia },
    { name: "Instagram : étiquette IA", on: etiquettes.instagram_contenu_ia },
    { name: "YouTube : contenu modifié ou synthétique", on: etiquettes.youtube_utilisation_ia },
    { name: "Contenu de marque (3 plateformes)", on: etiquettes.contenu_de_marque },
  ];
}

export function safeHttpUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? "";
  if (!URL.canParse(trimmed)) return null;
  return ["http:", "https:"].includes(new URL(trimmed).protocol) ? trimmed : null;
}

/** null si le rapport enregistré est illisible (schéma changé, donnée abîmée). */
export function toReportView(row: ReportRow): ReportView | null {
  const report = parseStoredReport(row.qaJson);
  if (!report) return null;
  const status = describeStatus(row);
  const awaiting = status.notice !== null;
  const ids = report.controles.map((check) => check.id);
  return {
    videoId: row.id,
    label: row.label,
    title: row.title,
    updatedLabel: row.updatedLabel,
    status,
    decision: report.decision,
    decisionLabel: qaDecisionLabels[report.decision],
    decisionTone: report.decision === "GO" ? "ok" : awaiting ? "wait" : "run",
    summary: report.resume_pour_humain.trim(),
    groups: toGroupViews(report.controles, awaiting),
    missingChecks: CHECK_IDS.filter((id) => !ids.includes(id)),
    koCount: report.controles.filter((check) => check.statut === "ko").length,
    labels: toLabelViews(report.etiquettes),
    mentions: report.mentions_a_incruster.map((mention) => mention.trim()).filter((mention) => mention !== ""),
    renderHref: safeHttpUrl(row.renderUrl),
  };
}
