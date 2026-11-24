import { describe, expect, it } from "vitest";
import { makeGateOutput, makeOutput } from "../fixtures";
import { parseActivationForm, parseAnswerForm } from "./forms";
import { actorName, buildProductionLog, DEFAULT_QUESTION, toBlockedVideoView, toProposalView, type BlockedVideoInput, type LogRun, type LogTransition } from "./view";

const video = { number: 31, title: "Le trombone" };
const at = (minute: number) => new Date(Date.UTC(2026, 10, 23, 9, minute));

const transition = (id: string, minute: number, overrides: Partial<LogTransition> = {}): LogTransition => ({
  id,
  createdAt: at(minute),
  video,
  from: "RESEARCH",
  to: "SCRIPT",
  event: "RESEARCH_DONE",
  actor: "agent-3",
  ...overrides,
});
const run = (id: string, minute: number, overrides: Partial<LogRun> = {}): LogRun => ({ id, createdAt: at(minute), video, agentId: 4, status: "OK", attempt: 1, ...overrides });

describe("journal de production", () => {
  it("mêle transitions et exécutions, de la plus récente à la plus ancienne", () => {
    const log = buildProductionLog([transition("a", 1), transition("b", 5, { event: "V2_APPROVED", from: "AWAITING_V2", to: "VISUALS_AND_AUDIO", actor: "proprio@example.test" })], [run("c", 3, { status: "CONTROL_FAILED", attempt: 2 })]);
    expect(log.map((entry) => entry.key)).toEqual(["t-b", "r-c", "t-a"]);
    expect(log[0]).toMatchObject({ video: "V-031 · Le trombone", agent: "Humain", action: "V2 validée (Attente V2 → Visuels et son)" });
    expect(log[1]).toMatchObject({ agent: "Scénariste", action: "Contrôle refusé (tentative 2/3)" });
    expect(log[2]).toMatchObject({ agent: "Recherchiste & fact-checker", action: "Dossier remis (Recherche → Script)" });
  });

  it("limité aux 50 dernières actions", () => {
    const runs = Array.from({ length: 40 }, (_, index) => run(`r${index}`, index));
    const transitions = Array.from({ length: 40 }, (_, index) => transition(`t${index}`, index));
    const log = buildProductionLog(transitions, runs);
    expect(log).toHaveLength(50);
    expect(log[0]?.dateIso).toBe(at(39).toISOString());
  });

  it("acteurs lisibles, sans l'adresse de l'humain", () => {
    expect(actorName("agent-0")).toBe("Orchestrateur");
    expect(actorName("système")).toBe("Système");
    expect(actorName("proprio@example.test")).toBe("Humain");
  });
});

describe("vidéos bloquées", () => {
  const base: Omit<BlockedVideoInput, "proposal"> = { id: "v1", video, blockedAt: "RESEARCH", blockedReason: "Aucune source fiable sur la date du brevet.", blockedSince: at(10) };

  it("question de l'orchestrateur posée depuis le blocage", () => {
    const proposal = { output: makeOutput({ statut: "bloque", question_humain: "Quelle source pour 1899 ?" }), createdAt: at(12) };
    expect(toBlockedVideoView({ ...base, proposal })).toMatchObject({ question: "Quelle source pour 1899 ?", source: "orchestrateur", stageLabel: "Bloquée à l'étape Recherche" });
  });

  it("proposition antérieure au blocage, illisible ou absente : la raison du blocage sert de question", () => {
    const old = { output: makeOutput({ question_humain: "Ancienne question" }), createdAt: at(2) };
    expect(toBlockedVideoView({ ...base, proposal: old })).toMatchObject({ question: base.blockedReason, source: "blocage" });
    expect(toBlockedVideoView({ ...base, proposal: { output: { cassé: true }, createdAt: at(12) } }).source).toBe("blocage");
    expect(toBlockedVideoView({ ...base, blockedReason: null, proposal: null }).question).toBe(DEFAULT_QUESTION);
  });
});

describe("dernières propositions", () => {
  it("résume la proposition, ignore une sortie illisible", () => {
    const view = toProposalView({ id: "r1", createdAt: at(0), video, output: makeGateOutput("AWAITING_V2") });
    expect(view).toMatchObject({ status: "Attente de validation", target: "humain", conform: true, problems: [] });
    expect(toProposalView({ id: "r2", createdAt: at(0), video: null, output: "pas un objet" })).toBeNull();
  });
});

describe("formulaires du panneau", () => {
  const form = (entries: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  };

  it("interrupteur : « true » ou « false », rien d'autre", () => {
    expect(parseActivationForm(form({ active: "true" }))).toBe(true);
    expect(parseActivationForm(form({ active: "false" }))).toBe(false);
    expect(parseActivationForm(form({ active: "oui" }))).toBeNull();
    expect(parseActivationForm(form({}))).toBeNull();
  });

  it("réponse : obligatoire, nettoyée, bornée", () => {
    expect(parseAnswerForm(form({ videoId: "v1", reponse: "  Prends la source INPI. " }))).toEqual({ ok: true, value: { videoId: "v1", answer: "Prends la source INPI." } });
    expect(parseAnswerForm(form({ videoId: "v1", reponse: "   " }))).toEqual({ ok: false, error: expect.stringContaining("Écris ta réponse") });
    expect(parseAnswerForm(form({ videoId: "v1", reponse: "x".repeat(2001) }))).toEqual({ ok: false, error: expect.stringContaining("2000") });
    expect(parseAnswerForm(form({ reponse: "ok" }))).toEqual({ ok: false, error: expect.stringContaining("Vidéo inconnue") });
  });
});
