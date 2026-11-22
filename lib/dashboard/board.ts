import type { Stage } from "@/lib/generated/prisma/client";

// Règles d'affichage du tableau de production (écran Production de la maquette).

export type BoardColumnKey = "idees" | "recherche" | "script" | "production" | "controle" | "publication";

export type BoardColumnDef = {
  key: BoardColumnKey;
  label: string;
  agents: string;
  stages: readonly Stage[];
};

export const boardColumns: readonly BoardColumnDef[] = [
  { key: "idees", label: "Idées", agents: "Agents 1 et 2", stages: ["IDEA", "AWAITING_V1"] },
  { key: "recherche", label: "Recherche", agents: "Agent 3", stages: ["RESEARCH"] },
  { key: "script", label: "Script", agents: "Agent 4, validation V2", stages: ["SCRIPT", "AWAITING_V2"] },
  { key: "production", label: "Production", agents: "Agents 5, 6 et 7", stages: ["VISUALS_AND_AUDIO", "EDIT", "RENDER"] },
  { key: "controle", label: "Contrôle", agents: "Agent 8, validation V3", stages: ["QA", "AWAITING_V3"] },
  { key: "publication", label: "Publication", agents: "Agents 9 et 10", stages: ["SCHEDULED", "PUBLISHED"] },
];

/** « wait » est le seul état en jaune : il attend une action humaine. */
export type CardTone = "wait" | "run" | "ok";

export type CardStatus = { tone: CardTone; label: string };

export type BoardVideo = {
  id: string;
  number: number;
  title: string;
  stage: Stage;
  blockedAt: Stage | null;
  blockedReason?: string | null;
};

export type BoardCard = BoardVideo & { status: CardStatus; swatch: string };

export type BoardColumn = BoardColumnDef & { cards: BoardCard[] };

const SWATCHES = ["#5A3A22", "#27406B", "#1E4636", "#8A5A00", "#3B2417"] as const;

/** Étape affichée : une vidéo en NEEDS_FIX reste dans la colonne de l'étape à reprendre. */
export function displayStage(video: Pick<BoardVideo, "stage" | "blockedAt">): Stage | null {
  if (video.stage === "REJECTED") return null;
  if (video.stage === "NEEDS_FIX") return video.blockedAt;
  return video.stage;
}

export function cardStatus(stage: Stage): CardStatus {
  switch (stage) {
    case "AWAITING_V1":
    case "AWAITING_V2":
    case "AWAITING_V3":
      return { tone: "wait", label: "À valider" };
    case "NEEDS_FIX":
      return { tone: "wait", label: "À corriger" };
    case "SCHEDULED":
      return { tone: "ok", label: "Programmée" };
    case "PUBLISHED":
      return { tone: "ok", label: "Publiée" };
    case "IDEA":
      return { tone: "run", label: "Idée" };
    case "REJECTED":
      return { tone: "run", label: "Écartée" };
    case "RESEARCH":
    case "SCRIPT":
    case "VISUALS_AND_AUDIO":
    case "EDIT":
    case "RENDER":
    case "QA":
      return { tone: "run", label: "En cours" };
  }
}

export function buildBoard(videos: readonly BoardVideo[]): BoardColumn[] {
  return boardColumns.map((column) => ({
    ...column,
    cards: videos
      .filter((video) => {
        const stage = displayStage(video);
        return stage !== null && column.stages.includes(stage);
      })
      .map((video) => ({ ...video, status: cardStatus(video.stage), swatch: SWATCHES[video.number % SWATCHES.length] ?? SWATCHES[0] })),
  }));
}

export function isWaitingForHuman(stage: Stage): boolean {
  return cardStatus(stage).tone === "wait";
}
