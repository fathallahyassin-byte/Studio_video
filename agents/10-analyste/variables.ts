import type { GroupStat, VideoMeta } from "./metadata";
import { toPercent, type AnalysisSnapshot } from "./snapshot";
import { exclusionLabels, MIN_AGE_HOURS, WINDOW_DAYS, type ScoredRow } from "./stats";

// Texte des variables du prompt. Les chiffres viennent tous du code : le modèle les cite, il ne les calcule pas.

export const NO_EXPERIMENTS = "Aucune expérience en cours.";

export const NO_CRITERION =
  "Aucun critère de validation de la niche dans la bible (objectifs.critere_validation_niche est vide ou encore à remplir). Ne conclus pas « pivoter » sans critère : dis-le dans la justification.";

/** Colonnes demandées par le prompt que l'import des statistiques ne fournit pas encore. */
export const MISSING_COLUMNS = ["retention_3s", "commentaires", "part_trafic_recherche"] as const;

export type RunningExperiment = { hypothesis: string; variable: string; successCriterion: string; startedAt: Date | null };

const day = (date: Date) => date.toISOString().slice(0, 10);

export function formatStats(snapshot: AnalysisSnapshot): string {
  const durations = new Map(snapshot.metas.map((meta) => [meta.videoId, meta.durationS]));
  const data = {
    mediane_par_plateforme: snapshot.medians.map((entry) => ({
      plateforme: entry.platform,
      nb_publications: entry.publications,
      vues: entry.values.views,
      duree_moyenne_s: entry.values.avgWatchTimeS,
      pct_visionnage_complet: toPercent(entry.values.completionRate),
      partages: entry.values.shares,
      enregistrements: entry.values.saves,
      abonnes_gagnes: entry.values.followersGained,
    })),
    classement: snapshot.ranking.map((score, rank) => ({
      rang: rank + 1,
      video_id: score.videoId,
      plateformes: score.platforms,
      indice: Math.round(score.index * 100) / 100,
      ecart_mediane_pct: score.gapPct,
    })),
    publications: snapshot.rows.map((row) => formatRow(row, durations.get(row.sample.videoId) ?? null)),
    regroupements: snapshot.groups.map(formatGroup),
    colonnes_absentes: MISSING_COLUMNS,
  };
  return [statsHeader(snapshot), JSON.stringify(data, null, 2)].join("\n");
}

function statsHeader(snapshot: AnalysisSnapshot): string {
  const { top, flop } = snapshot.expected;
  return [
    `Période ${snapshot.period} : publications du ${day(snapshot.since)} au ${day(snapshot.now)} (${WINDOW_DAYS} jours), dernier relevé de chacune (valeurs cumulées).`,
    `Médianes, écarts et indices calculés en code sur les seules publications de plus de ${MIN_AGE_HOURS} h ayant un relevé : ne recalcule rien et ne cite que les pourcentages ci-dessous.`,
    "Indice d'une publication = moyenne de (vues / médiane) et (vue complète / médiane) de sa plateforme ; 1 = la médiane. Indice d'une vidéo = moyenne de ses plateformes.",
    `Top attendu : ${top} vidéo(s), flop attendu : ${flop}, choisis dans « classement » (${snapshot.ranking.length} vidéo(s) comparable(s)). Les publications « exclue » ne servent qu'à signaler un biais.`,
  ].join("\n");
}

function formatRow(row: ScoredRow, durationS: number | null) {
  const { sample } = row;
  return {
    video_id: sample.videoId,
    plateforme: sample.platform,
    date_publication: sample.publishedAt?.toISOString() ?? null,
    age_h: row.ageHours === null ? null : Math.floor(row.ageHours),
    exclue: row.exclusion === null ? null : exclusionLabels[row.exclusion],
    vues: sample.stat?.views ?? null,
    duree_moyenne_s: sample.stat?.avgWatchTimeS ?? null,
    duree_video_s: durationS,
    pct_visionnage_complet: sample.stat ? toPercent(sample.stat.completionRate) : null,
    partages: sample.stat?.shares ?? null,
    enregistrements: sample.stat?.saves ?? null,
    abonnes_gagnes: sample.stat?.followersGained ?? null,
    ecart_mediane_pct: row.exclusion === null ? formatGaps(row) : null,
  };
}

function formatGaps(row: ScoredRow) {
  return {
    vues: row.gaps.views,
    pct_visionnage_complet: row.gaps.completionRate,
    duree_moyenne_s: row.gaps.avgWatchTimeS,
    partages: row.gaps.shares,
    enregistrements: row.gaps.saves,
    abonnes_gagnes: row.gaps.followersGained,
  };
}

function formatGroup(group: GroupStat) {
  return {
    critere: group.dimension,
    valeur: group.value,
    [group.dimension === "creneau" ? "nb_publications" : "nb_videos"]: group.count,
    indice_median: Math.round(group.medianIndex * 100) / 100,
    ecart_mediane_pct: group.gapPct,
  };
}

export function formatMetadata(metas: readonly VideoMeta[]): string {
  const data = metas.map((meta) => ({
    video_id: meta.videoId,
    numero: meta.label,
    titre: meta.title,
    pilier: meta.pillar,
    format: meta.format,
    type_accroche: meta.hookType,
    accroche: meta.hookText,
    duree_s: meta.durationS,
    visuel_dominant: meta.visual,
    creneaux: meta.slots.map((slot) => ({ plateforme: slot.platform, creneau: slot.label })),
    versions_prompts: meta.promptVersions.map((entry) => `agent ${entry.agentId} v${entry.version}`),
  }));
  return JSON.stringify(data, null, 2);
}

export function formatExperiments(experiments: readonly RunningExperiment[]): string {
  if (experiments.length === 0) return NO_EXPERIMENTS;
  const data = experiments.map((experiment) => ({
    hypothese: experiment.hypothesis,
    variable: experiment.variable,
    critere_reussite: experiment.successCriterion,
    lancee_le: experiment.startedAt ? day(experiment.startedAt) : null,
  }));
  return JSON.stringify(data, null, 2);
}

export function formatCriterion(criterion: string | null): string {
  return criterion ?? NO_CRITERION;
}
