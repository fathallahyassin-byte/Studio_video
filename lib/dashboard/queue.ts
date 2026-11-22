import type { Stage } from "@/lib/generated/prisma/client";

// File « À valider » : V1 regroupe toutes les idées en attente, V2 et V3 sont une entrée par vidéo.

export type Gate = "V1" | "V2" | "V3";

export type QueueVideo = {
  id: string;
  number: number;
  title: string;
  stage: Stage;
  updatedAt: Date;
};

export type QueueItem = {
  /** identifiant d'URL : « v1 » ou l'id de la vidéo */
  key: string;
  gate: Gate;
  gateLabel: string;
  title: string;
  agentName: string;
  since: Date;
  videoIds: string[];
  /** numéro de la vidéo pour V2 et V3 ; null pour le lot d'idées V1 */
  videoNumber: number | null;
};

const GATES: Record<Gate, { stage: Stage; label: string; agentName: string }> = {
  V1: { stage: "AWAITING_V1", label: "V1 · Idées", agentName: "Veilleur" },
  V2: { stage: "AWAITING_V2", label: "V2 · Script", agentName: "Scénariste" },
  V3: { stage: "AWAITING_V3", label: "V3 · GO final", agentName: "Contrôle qualité" },
};

export const AWAITING_STAGES: readonly Stage[] = ["AWAITING_V1", "AWAITING_V2", "AWAITING_V3"];

export function buildQueue(videos: readonly QueueVideo[]): QueueItem[] {
  const byOldest = [...videos].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
  const ideas = byOldest.filter((video) => video.stage === "AWAITING_V1");
  const items: QueueItem[] = [];

  if (ideas.length > 0) {
    items.push({
      key: "v1",
      gate: "V1",
      gateLabel: GATES.V1.label,
      title: ideas.length === 1 ? "1 idée à trier" : `${ideas.length} idées à trier`,
      agentName: GATES.V1.agentName,
      since: ideas.reduce((latest, video) => (video.updatedAt > latest ? video.updatedAt : latest), ideas[0]?.updatedAt ?? new Date(0)),
      videoIds: ideas.map((video) => video.id),
      videoNumber: null,
    });
  }
  for (const gate of ["V2", "V3"] as const) {
    for (const video of byOldest.filter((candidate) => candidate.stage === GATES[gate].stage)) {
      items.push({
        key: video.id,
        gate,
        gateLabel: GATES[gate].label,
        title: video.title,
        agentName: GATES[gate].agentName,
        since: video.updatedAt,
        videoIds: [video.id],
        videoNumber: video.number,
      });
    }
  }
  return items;
}

export function selectQueueItem(items: readonly QueueItem[], key: string | undefined): QueueItem | undefined {
  return items.find((item) => item.key === key) ?? items[0];
}
