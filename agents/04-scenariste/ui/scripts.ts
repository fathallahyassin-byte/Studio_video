import type { ChipTone } from "@/components/ui";
import type { Decision, Stage } from "@/lib/generated/prisma/client";
import { countScriptWords, estimateDurationS, isWordCountOk, roundTenth, targetWords, type Role, type ScriptTarget } from "../rules";
import type { Output } from "../schema";
import { parseStoredDossier, parseStoredScript, type Dossier } from "../variables";

// Modèle de vue du panneau : données sérialisables, calculées côté serveur (fonctions pures).

export type ScriptRow = {
  id: string;
  label: string;
  title: string;
  stage: Stage;
  blockedAt: Stage | null;
  updatedLabel: string;
  /** dernière décision V2 de l'humain, null s'il n'y en a pas encore */
  lastV2Decision: Decision | null;
  lastV2Note: string | null;
  scriptJson: unknown;
  dossierJson: unknown;
};

/** `notice` non nul : le script attend une action de l'humain (seul cas affiché en jaune). */
export type V2Status = { label: string; tone: ChipTone; notice: string | null };

export type FactView = {
  id: string;
  fait: string;
  formulationPrudente: string;
  confidenceLabel: string;
  sourceText: string;
  href: string | null;
};

export type HookView = { type: string; voix: string; texteEcran: string; recommended: boolean };

export type BeatView = {
  n: number;
  role: Role;
  roleLabel: string;
  timeLabel: string;
  /** position et largeur sur la frise, en % de la durée totale */
  offsetPct: number;
  widthPct: number;
  voix: string;
  texteEcran: string;
  intention: string;
  factIds: string[];
};

export type Counters = {
  words: number;
  estimatedS: number;
  /** null quand aucune bible lisible n'est active */
  targetS: number | null;
  targetWords: number | null;
  gapS: number | null;
  gapPct: number | null;
  withinTolerance: boolean | null;
};

/** Contenu d'un script prêt à afficher : panneau de l'agent et détail V2 de « À valider ». */
export type ScriptContent = {
  titreInterne: string;
  hooks: HookView[];
  beats: BeatView[];
  totalS: number;
  counters: Counters;
  cta: string | null;
  /** faits du dossier, par id ; vide si le dossier est illisible */
  facts: Record<string, FactView>;
};

export type ScriptView = ScriptContent & {
  videoId: string;
  label: string;
  title: string;
  updatedLabel: string;
  status: V2Status;
  correctionNote: string | null;
};

export const roleLabels: Record<Role, string> = {
  accroche: "Accroche",
  contexte: "Contexte",
  revelation: "Révélation",
  chute: "Chute",
  boucle: "Boucle",
};

const hookTypeLabels: Record<Output["accroches"][number]["type"], string> = {
  question: "Question",
  affirmation: "Affirmation",
  situation: "Mise en situation",
};

const confidenceLabels: Record<Dossier["faits"][number]["confiance"], string> = {
  eleve: "confiance élevée",
  moyen: "confiance moyenne",
  faible: "confiance faible · interdit",
};

export function describeV2Status(row: Pick<ScriptRow, "stage" | "blockedAt" | "lastV2Decision">): V2Status {
  if (row.stage === "AWAITING_V2") return { label: "À valider (V2)", tone: "wait", notice: "Ce script attend ta validation V2." };
  if (row.stage === "NEEDS_FIX" && row.blockedAt === "SCRIPT") return { label: "Bloqué : à corriger", tone: "wait", notice: "Ce script est bloqué : il attend ta décision." };
  if (row.stage === "SCRIPT") {
    return row.lastV2Decision === "CHANGES_REQUESTED"
      ? { label: "Correction demandée · en réécriture", tone: "run", notice: null }
      : { label: "En écriture", tone: "run", notice: null };
  }
  if (row.stage === "REJECTED") return { label: "Abandonnée", tone: "run", notice: null };
  if (row.lastV2Decision === "APPROVED") return { label: "V2 validée", tone: "ok", notice: null };
  return { label: "Sans décision V2", tone: "run", notice: null };
}

export function formatSeconds(value: number): string {
  return String(roundTenth(value)).replace(".", ",");
}

export function computeCounters(script: Output, target: ScriptTarget | null): Counters {
  const words = countScriptWords(script.beats);
  const rate = target?.wordsPerSecond ?? (script.duree_estimee_s > 0 ? script.nb_mots / script.duree_estimee_s : 0);
  const estimatedS = rate > 0 ? estimateDurationS(words, rate) : script.duree_estimee_s;
  if (!target) return { words, estimatedS, targetS: null, targetWords: null, gapS: null, gapPct: null, withinTolerance: null };
  const gapS = roundTenth(estimatedS - target.durationS);
  return {
    words,
    estimatedS,
    targetS: target.durationS,
    targetWords: Math.round(targetWords(target)),
    gapS,
    gapPct: Math.round((gapS / target.durationS) * 1000) / 10,
    withinTolerance: isWordCountOk(words, target),
  };
}

/** Beats placés sur une frise de 0 à la fin du dernier beat. */
export function toBeatViews(beats: Output["beats"]): { beats: BeatView[]; totalS: number } {
  const totalS = Math.max(0, ...beats.map((beat) => beat.fin_s));
  const pct = (value: number) => (totalS > 0 ? Math.round((value / totalS) * 10000) / 100 : 0);
  return {
    totalS,
    beats: beats.map((beat) => ({
      n: beat.n,
      role: beat.role,
      roleLabel: roleLabels[beat.role],
      timeLabel: `${formatSeconds(beat.debut_s)}–${formatSeconds(beat.fin_s)} s`,
      offsetPct: pct(beat.debut_s),
      widthPct: pct(Math.max(0, beat.fin_s - beat.debut_s)),
      voix: beat.voix,
      texteEcran: beat.texte_ecran,
      intention: beat.intention_visuelle,
      factIds: beat.faits.map((id) => id.trim()),
    })),
  };
}

function isHttpUrl(url: string): boolean {
  const trimmed = url.trim();
  return URL.canParse(trimmed) && ["http:", "https:"].includes(new URL(trimmed).protocol);
}

function toFactViews(dossierJson: unknown): Record<string, FactView> {
  const dossier = parseStoredDossier(dossierJson);
  if (!dossier) return {};
  return Object.fromEntries(
    dossier.faits.map((fact) => {
      const sourceParts = [fact.source.titre, fact.source.auteur, fact.source.date].map((part) => part.trim()).filter((part) => part !== "");
      const view: FactView = {
        id: fact.id,
        fait: fact.fait,
        formulationPrudente: fact.formulation_prudente,
        confidenceLabel: confidenceLabels[fact.confiance],
        sourceText: sourceParts.length === 0 ? "Source à trouver" : sourceParts.join(" · "),
        href: isHttpUrl(fact.source.url) ? fact.source.url.trim() : null,
      };
      return [fact.id.trim(), view];
    }),
  );
}

/** null si le script enregistré est illisible (schéma changé, donnée abîmée). */
export function toScriptContent(scriptJson: unknown, dossierJson: unknown, target: ScriptTarget | null): ScriptContent | null {
  const script = parseStoredScript(scriptJson);
  if (!script) return null;
  const { beats, totalS } = toBeatViews(script.beats);
  return {
    titreInterne: script.titre_interne,
    hooks: script.accroches.map((hook, index) => ({ type: hookTypeLabels[hook.type], voix: hook.voix, texteEcran: hook.texte_ecran, recommended: index === 0 })),
    beats,
    totalS,
    counters: computeCounters(script, target),
    cta: script.cta?.trim() || null,
    facts: toFactViews(dossierJson),
  };
}

export function toScriptView(row: ScriptRow, target: ScriptTarget | null): ScriptView | null {
  const content = toScriptContent(row.scriptJson, row.dossierJson, target);
  if (!content) return null;
  return {
    ...content,
    videoId: row.id,
    label: row.label,
    title: row.title,
    updatedLabel: row.updatedLabel,
    status: describeV2Status(row),
    correctionNote: row.lastV2Decision === "CHANGES_REQUESTED" ? row.lastV2Note?.trim() || null : null,
  };
}

export function formatGap(counters: Counters): string {
  if (counters.gapS === null || counters.gapPct === null) return "—";
  const sign = counters.gapS > 0 ? "+" : counters.gapS < 0 ? "−" : "±";
  return `${sign}${formatSeconds(Math.abs(counters.gapS))} s (${sign}${String(Math.abs(counters.gapPct)).replace(".", ",")} %)`;
}
