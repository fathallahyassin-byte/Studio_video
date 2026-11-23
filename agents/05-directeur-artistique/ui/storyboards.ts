import type { ChipTone } from "@/components/ui";
import { formatTimeRange } from "@/lib/dashboard/format";
import type { Stage } from "@/lib/generated/prisma/client";
import { computeVideoAiSeconds, isGenerated, planDuration, roundTenth, type Plan, type PlanType } from "../rules";
import { parseStoredStoryboard } from "../variables";

// Modèle de vue du panneau : données sérialisables, calculées côté serveur (fonctions pures).

export type StoryboardRow = {
  id: string;
  label: string;
  title: string;
  stage: Stage;
  blockedAt: Stage | null;
  blockedReason: string | null;
  updatedLabel: string;
  storyboardJson: unknown;
};

/** Dernier média enregistré pour un plan (Asset IMAGE ou VIDEO). */
export type PlanAsset = { planId: string; kind: "IMAGE" | "VIDEO"; url: string; /** fichier ajouté à la main (pas généré) */ manual: boolean };

export type MediaState = "generated" | "provided" | "to_generate" | "edit" | "to_source";

export type PlanView = {
  id: string;
  beat: number;
  type: PlanType;
  typeLabel: string;
  timeLabel: string;
  durationLabel: string;
  description: string;
  prompt: string | null;
  negativePrompt: string | null;
  stockKeywords: string[];
  screenText: string;
  aiLabel: boolean;
  isCover: boolean;
  regenerable: boolean;
  /** plan qui demande un fichier (tout sauf le texte animé) : « Ajouter le fichier du plan » */
  acceptsFile: boolean;
  media: { state: MediaState; label: string; url: string | null; kind: "IMAGE" | "VIDEO" | null };
};

export type BudgetView = { totalS: number; budgetS: number | null; over: boolean; ratio: number };

/** `notice` non nul : la vidéo attend une action de l'humain (seul cas affiché en jaune). */
export type StoryboardStatus = { label: string; tone: ChipTone; notice: string | null };

export type StoryboardView = {
  videoId: string;
  label: string;
  title: string;
  updatedLabel: string;
  status: StoryboardStatus;
  plans: PlanView[];
  budget: BudgetView;
  cover: { plan: string; text: string };
  recurringCharacters: { name: string; description: string }[];
  /** la régénération est possible à cette étape (avant le rendu) */
  editable: boolean;
};

export const typeLabels: Record<PlanType, string> = {
  texte_anime: "Texte animé",
  image_ia_animee: "Image IA animée",
  video_ia: "Vidéo IA",
  stock: "Séquence libre de droits",
};

export function formatSeconds(value: number): string {
  return String(roundTenth(value)).replace(".", ",");
}

export function toBudgetView(plans: readonly Plan[], budgetS: number | null): BudgetView {
  const totalS = computeVideoAiSeconds(plans);
  if (budgetS === null) return { totalS, budgetS, over: false, ratio: 0 };
  const ratio = budgetS === 0 ? (totalS > 0 ? 1 : 0) : Math.min(totalS / budgetS, 1);
  return { totalS, budgetS, over: totalS > budgetS, ratio };
}

function mediaOf(plan: Plan, assets: readonly PlanAsset[]): PlanView["media"] {
  if (plan.type === "texte_anime") return { state: "edit", label: "Fait au montage", url: null, kind: null };
  const asset = assets.find((entry) => entry.planId === plan.id);
  if (asset?.manual) return { state: "provided", label: "Fichier ajouté", url: asset.url, kind: asset.kind };
  if (asset) return { state: "generated", label: "Généré", url: asset.url, kind: asset.kind };
  if (plan.type === "stock") return { state: "to_source", label: "À sourcer (mots-clés)", url: null, kind: null };
  return { state: "to_generate", label: "Pas encore généré", url: null, kind: null };
}

export function toPlanView(plan: Plan, assets: readonly PlanAsset[], coverPlan: string): PlanView {
  return {
    id: plan.id,
    beat: plan.beat,
    type: plan.type,
    typeLabel: typeLabels[plan.type],
    timeLabel: formatTimeRange(plan.debut_s, plan.fin_s),
    durationLabel: `${formatSeconds(planDuration(plan))} s`,
    description: plan.description_fr,
    prompt: plan.prompt_en,
    negativePrompt: plan.negative_prompt_en,
    stockKeywords: plan.mots_cles_stock.filter((keyword) => keyword.trim() !== ""),
    screenText: plan.texte_ecran,
    aiLabel: plan.label_ia_requis,
    isCover: plan.id === coverPlan,
    regenerable: isGenerated(plan.type),
    acceptsFile: plan.type !== "texte_anime",
    media: mediaOf(plan, assets),
  };
}

const EDITABLE_STAGES: readonly Stage[] = ["VISUALS_AND_AUDIO", "EDIT"];

export function toStatus(row: Pick<StoryboardRow, "stage" | "blockedAt" | "blockedReason">, budget: BudgetView): StoryboardStatus {
  if (row.stage === "NEEDS_FIX" && row.blockedAt === "VISUALS_AND_AUDIO") {
    return { label: "À corriger", tone: "wait", notice: row.blockedReason ?? "Vidéo bloquée à l'étape des visuels." };
  }
  if (budget.over) return { label: "Budget vidéo IA dépassé", tone: "wait", notice: "Ce storyboard dépasse le budget de secondes de vidéo IA." };
  if (row.stage === "VISUALS_AND_AUDIO") return { label: "Visuels en cours", tone: "run", notice: null };
  if (row.stage === "REJECTED") return { label: "Écartée", tone: "run", notice: null };
  return { label: "Storyboard prêt", tone: "ok", notice: null };
}

function isEditable(row: Pick<StoryboardRow, "stage" | "blockedAt">): boolean {
  if (EDITABLE_STAGES.includes(row.stage)) return true;
  return row.stage === "NEEDS_FIX" && row.blockedAt !== null && EDITABLE_STAGES.includes(row.blockedAt);
}

/** null si le storyboard enregistré est illisible (il est alors compté à part). */
export function toStoryboardView(row: StoryboardRow, assets: readonly PlanAsset[], budgetS: number | null): StoryboardView | null {
  const storyboard = parseStoredStoryboard(row.storyboardJson);
  if (!storyboard) return null;
  const plans = [...storyboard.plans].sort((a, b) => a.debut_s - b.debut_s);
  const budget = toBudgetView(plans, budgetS);
  return {
    videoId: row.id,
    label: row.label,
    title: row.title,
    updatedLabel: row.updatedLabel,
    status: toStatus(row, budget),
    plans: plans.map((plan) => toPlanView(plan, assets, storyboard.couverture.plan)),
    budget,
    cover: { plan: storyboard.couverture.plan, text: storyboard.couverture.texte },
    recurringCharacters: storyboard.personnages_recurrents.map((character) => ({ name: character.nom, description: character.description_en })),
    editable: isEditable(row),
  };
}

/** Garde le média le plus récent de chaque plan (assets triés du plus récent au plus ancien). */
export function latestAssets(assets: readonly (PlanAsset & { videoId: string })[], videoId: string): PlanAsset[] {
  const seen = new Set<string>();
  const latest: PlanAsset[] = [];
  for (const asset of assets) {
    if (asset.videoId !== videoId || seen.has(asset.planId)) continue;
    seen.add(asset.planId);
    latest.push({ planId: asset.planId, kind: asset.kind, url: asset.url, manual: asset.manual });
  }
  return latest;
}
