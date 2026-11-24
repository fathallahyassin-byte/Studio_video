import type { Stage } from "@/lib/generated/prisma/client";
import type { OrchestratorPorts, ProjectState } from "./ports";
import type { Output } from "./schema";

// Données et faux ports des tests (aucune base, aucun appel réseau).

export const VIDEO_ID = "video-1";
export const CHANNEL_ID = "chaine-1";
export const TEST_BIBLE = "niche: objets du quotidien\nton: curieux";
export const NOW = new Date("2026-11-23T09:30:00.000Z");

export function makeProject(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    id: VIDEO_ID,
    number: 31,
    title: "Pourquoi le trombone a cette forme",
    stage: "SCRIPT",
    blockedAt: null,
    blockedReason: null,
    partnership: "aucun",
    totalCost: 0.42,
    deliverables: {
      idee: { id: "I-07", angle: "la forme du trombone" },
      dossier: { faits: [{ texte: "Breveté en 1899", confiance: "haute" }] },
      script: null,
      storyboard: null,
      audio: null,
      timeline: null,
      qa: null,
      publication: null,
    },
    runs: [{ agentId: 3, status: "OK", attempt: 1, error: null, cost: 0.12, createdAt: new Date("2026-11-23T09:00:00.000Z") }],
    validations: [{ gate: "V1", decision: "APPROVED", note: null, decidedBy: "proprietaire@example.test", createdAt: new Date("2026-11-22T18:00:00.000Z") }],
    transitions: [
      { from: "RESEARCH", to: "SCRIPT", event: "RESEARCH_DONE", actor: "agent-3", note: null, createdAt: new Date("2026-11-23T09:00:00.000Z") },
      { from: "AWAITING_V1", to: "RESEARCH", event: "V1_APPROVED", actor: "proprietaire@example.test", note: null, createdAt: new Date("2026-11-22T18:00:00.000Z") },
    ],
    ...overrides,
  };
}

/** Une proposition valide pour une vidéo à l'étape SCRIPT. */
export function makeOutput(overrides: Partial<Output> = {}): Output {
  return {
    video_id: VIDEO_ID,
    etape_actuelle: "SCRIPT",
    statut: "en_cours",
    prochaine_action: {
      agent: "scenariste",
      consigne: "Écris le script minuté de 30 s à partir du dossier, avec 3 accroches, au ton de la bible.",
      entrees: { dossier: "dossierJson", duree_cible_s: 30 },
    },
    controle_dernier_livrable: { agent: "recherchiste", conforme: true, problemes: [] },
    question_humain: null,
    journal: ["2026-11-23 09:30 — Dossier contrôlé : conforme, consigne envoyée au scénariste"],
    ...overrides,
  };
}

/** Proposition attendue à une validation : l'humain seul. */
export function makeGateOutput(stage: Stage, overrides: Partial<Output> = {}): Output {
  return makeOutput({
    etape_actuelle: stage,
    statut: "attente_validation",
    prochaine_action: { agent: "humain", consigne: "Relis le script et décide dans l'écran Validations.", entrees: {} },
    controle_dernier_livrable: { agent: "scenariste", conforme: true, problemes: [] },
    question_humain: "Script de 30 s, 6 beats, accroche n°2 recommandée.\nDécision attendue : valider ou demander une correction.",
    ...overrides,
  });
}

export type FakePorts = {
  ports: OrchestratorPorts;
  calls: { loadProject: number; isActive: number };
  setProject(project: ProjectState | null): void;
  setActive(active: boolean): void;
};

export function makePorts(options: { project?: ProjectState | null; active?: boolean; budget?: string | undefined } = {}): FakePorts {
  let project = options.project === undefined ? makeProject() : options.project;
  let active = options.active ?? true;
  const budget = "budget" in options ? options.budget : "5";
  const calls = { loadProject: 0, isActive: 0 };
  const ports: OrchestratorPorts = {
    async loadProject(videoId) {
      calls.loadProject += 1;
      return project && project.id === videoId ? project : null;
    },
    async isActive() {
      calls.isActive += 1;
      return active;
    },
    readRawBudget: () => budget,
    now: () => NOW,
  };
  return {
    ports,
    calls,
    setProject(next) {
      project = next;
    },
    setActive(next) {
      active = next;
    },
  };
}
