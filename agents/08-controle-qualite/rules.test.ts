import { describe, expect, it } from "vitest";
import { canonicalAgent, checksNeeding, decideFromChecks, missingSourcesFor, stricterDecision } from "./checklist";
import { koCheck, makeChecks, makeContext, makeReport, withCheck } from "./fixtures";
import { toPublicationLabels } from "./labels";
import {
  checkDecisionBacked,
  checkFailures,
  checkIdeaId,
  checkIds,
  checkLabels,
  checkMentions,
  checkProofs,
  checkReport,
  checkSummary,
  formatBlockReason,
  normalizeReport,
  responsibleAgent,
  UNVERIFIED_PREFIX,
} from "./rules";

const ok = { ok: true };
const failure = (text: string) => ({ ok: false, reason: expect.stringContaining(text) });
const statusOf = (report: ReturnType<typeof makeReport>, id: string) => report.controles.find((check) => check.id === id);

describe("décision", () => {
  it("se recalcule à partir des points : A, C ou D ko → NO_GO ; B, E ou F seuls → GO_AVEC_CORRECTIONS ; sinon GO", () => {
    expect(decideFromChecks(makeChecks())).toBe("GO");
    expect(decideFromChecks(withCheck("E4", koCheck("Boucler", "04-scenariste")).controles)).toBe("GO_AVEC_CORRECTIONS");
    expect(decideFromChecks(withCheck("C1", koCheck("Licence", "06-voix-son")).controles)).toBe("NO_GO");
    expect(decideFromChecks(withCheck("D5", koCheck("Retirer", "05-directeur-artistique")).controles)).toBe("NO_GO");
  });

  it("la plus stricte l'emporte", () => {
    expect(stricterDecision("GO", "NO_GO")).toBe("NO_GO");
    expect(stricterDecision("NO_GO", "GO_AVEC_CORRECTIONS")).toBe("NO_GO");
    expect(stricterDecision("GO_AVEC_CORRECTIONS", "GO")).toBe("GO_AVEC_CORRECTIONS");
  });

  it("normalize : le modèle dit GO mais A1 est ko → NO_GO", () => {
    const report = withCheck("A1", koCheck("Corriger la date", "04-scenariste"), makeReport({ decision: "GO" }));
    expect(normalizeReport(report, makeContext()).decision).toBe("NO_GO");
  });

  it("normalize : le modèle dit GO mais E2 est ko → GO_AVEC_CORRECTIONS", () => {
    const report = withCheck("E2", koCheck("Recaler", "07-monteur"), makeReport({ decision: "GO" }));
    expect(normalizeReport(report, makeContext()).decision).toBe("GO_AVEC_CORRECTIONS");
  });

  it("normalize : le modèle, plus strict, garde son NO_GO quand seul E1 est ko", () => {
    const report = withCheck("E1", koCheck("Refaire le montage", "07-monteur"), makeReport({ decision: "NO_GO" }));
    expect(normalizeReport(report, makeContext()).decision).toBe("NO_GO");
  });
});

describe("normalize", () => {
  it("rapport complet et cohérent : inchangé", () => {
    const report = makeReport();
    expect(normalizeReport(report, makeContext())).toEqual(report);
  });

  it("met l'agent responsable sous sa forme canonique et vide une correction blanche", () => {
    const report = withCheck("E4", { statut: "ko", preuve: "Fin plate.", correction: "  Reprendre la boucle ", agent_responsable: "Scénariste" });
    const normalized = normalizeReport(withCheck("B2", { correction: "  " }, report), makeContext());
    expect(statusOf(normalized, "E4")).toMatchObject({ correction: "Reprendre la boucle", agent_responsable: "04-scenariste" });
    expect(statusOf(normalized, "B2")?.correction).toBeNull();
  });

  it("source absente : les points qui en dépendent passent en ko « non vérifié », avec correction et agent", () => {
    const qa = makeContext({ available: { STORYBOARD: true, PLAN_SONORE: true, TIMELINE: true, TRANSCRIPTION: false, CAPTURES: true } });
    const normalized = normalizeReport(makeReport(), qa);
    for (const id of ["A1", "A2", "E2", "F1"]) {
      expect(statusOf(normalized, id)).toMatchObject({
        statut: "ko",
        preuve: expect.stringContaining(`${UNVERIFIED_PREFIX} transcription Whisper du rendu non disponible(s).`),
        correction: expect.stringContaining("relancer le contrôle qualité"),
        agent_responsable: "08-controle-qualite",
      });
    }
    expect(statusOf(normalized, "B1")?.statut).toBe("ok");
    expect(normalized.decision).toBe("NO_GO");
  });

  it("un « na » sur une source absente devient aussi ko, sauf D3 et D4 sans partenariat", () => {
    const qa = makeContext({ available: { STORYBOARD: false, PLAN_SONORE: true, TIMELINE: false, TRANSCRIPTION: true, CAPTURES: true } });
    const normalized = normalizeReport(makeReport(), qa);
    expect(statusOf(normalized, "D2")).toMatchObject({ statut: "ko", agent_responsable: "05-directeur-artistique" });
    expect(statusOf(normalized, "D3")?.statut).toBe("na");
    expect(statusOf(normalized, "D4")?.statut).toBe("na");
    const withPartner = normalizeReport(makeReport(), { ...qa, hasPartnership: true });
    expect(statusOf(withPartner, "D3")).toMatchObject({ statut: "ko", agent_responsable: "07-monteur" });
  });

  it("garde le ko du modèle et ses champs sur un point non vérifiable", () => {
    const qa = makeContext({ available: { STORYBOARD: true, PLAN_SONORE: false, TIMELINE: true, TRANSCRIPTION: true, CAPTURES: true } });
    const report = withCheck("C1", koCheck("Changer de musique", "06-voix-son"));
    expect(statusOf(normalizeReport(report, qa), "C1")).toMatchObject({ statut: "ko", correction: "Changer de musique", agent_responsable: "06-voix-son" });
  });

  it("est idempotent (préfixe « non vérifié » non répété)", () => {
    const qa = makeContext({ available: { STORYBOARD: false, PLAN_SONORE: false, TIMELINE: false, TRANSCRIPTION: false, CAPTURES: false } });
    const once = normalizeReport(makeReport(), qa);
    expect(normalizeReport(once, qa)).toEqual(once);
  });

  it("E1 : durée de la timeline hors de la cible de la bible → ko en code", () => {
    const normalized = normalizeReport(makeReport(), makeContext({ timelineDurationS: 41 }));
    expect(statusOf(normalized, "E1")).toMatchObject({ statut: "ko", preuve: expect.stringContaining("41 s, hors de la cible de la bible (20 à 30 s)"), agent_responsable: "07-monteur" });
    expect(normalized.decision).toBe("GO_AVEC_CORRECTIONS");
    expect(statusOf(normalizeReport(makeReport(), makeContext({ timelineDurationS: 30.4 })), "E1")?.statut).toBe("ok");
  });

  it("nettoie les mentions (espaces, doublons, vides)", () => {
    const normalized = normalizeReport(makeReport({ mentions_a_incruster: [" Publicité ", "publicité", ""] }), makeContext());
    expect(normalized.mentions_a_incruster).toEqual(["Publicité"]);
  });
});

describe("controls", () => {
  it("rapport valide : tout passe", () => {
    expect(checkReport(makeReport(), makeContext()).every((result) => result.ok)).toBe(true);
  });

  it("ids : manquants, inconnus et doublons refusés", () => {
    const controles = makeChecks().filter((check) => check.id !== "C2");
    const first = controles[0];
    if (!first) throw new Error("check-list vide");
    controles.push({ ...first, id: "A3" }, { ...first });
    const result = checkIds(controles);
    expect(result).toEqual(failure("points inconnus : A3"));
    expect(result).toEqual(failure("points en double : A1"));
    expect(result).toEqual(failure("points manquants : C2"));
    expect(checkIds(makeChecks())).toEqual(ok);
  });

  it("preuve obligatoire pour chaque point, même ok ou na", () => {
    expect(checkProofs(withCheck("D3", { preuve: " " }).controles)).toEqual(failure("Preuve vide pour : D3"));
  });

  it("ko sans correction ou sans agent responsable valide : refusé", () => {
    expect(checkFailures(withCheck("E4", { statut: "ko", correction: null, agent_responsable: "04-scenariste" }).controles)).toEqual(failure("E4 : correction manquante"));
    expect(checkFailures(withCheck("E4", koCheck("Boucler", "le stagiaire")).controles)).toEqual(failure("agent_responsable « le stagiaire » invalide"));
    expect(checkFailures(withCheck("E4", koCheck("Boucler", "10-analyste")).controles)).toEqual(failure("invalide"));
    expect(checkFailures(withCheck("E4", koCheck("Boucler", "04-scenariste")).controles)).toEqual(ok);
  });

  it("NO_GO ou GO_AVEC_CORRECTIONS sans aucun point ko : refusé", () => {
    expect(checkDecisionBacked(makeReport({ decision: "NO_GO" }))).toEqual(failure("sans aucun point « ko »"));
    expect(checkDecisionBacked(makeReport({ decision: "GO" }))).toEqual(ok);
  });

  it("idee_id différent de l'idée de la vidéo : refusé", () => {
    expect(checkIdeaId("I-99", "I-07")).toEqual(failure("ne correspond pas"));
    expect(checkIdeaId("I-99", null)).toEqual(ok);
  });

  it("résumé : non vide et 5 lignes au maximum", () => {
    expect(checkSummary("")).toEqual(failure("vide"));
    expect(checkSummary("1\n2\n3\n4\n5\n6")).toEqual(failure("6 lignes"));
    expect(checkSummary("1\n\n2\n3\n4\n5")).toEqual(ok);
  });

  it("étiquettes : voix de synthèse → TikTok et Instagram obligatoires", () => {
    const labels = { tiktok_contenu_ia: false, instagram_contenu_ia: true, youtube_utilisation_ia: false, contenu_de_marque: false };
    expect(checkLabels(labels, makeContext())).toEqual(failure("tiktok_contenu_ia doit être true (voix off de synthèse)"));
  });

  it("étiquettes : plan réaliste généré par IA → YouTube obligatoire aussi", () => {
    const labels = { tiktok_contenu_ia: true, instagram_contenu_ia: true, youtube_utilisation_ia: false, contenu_de_marque: false };
    const qa = makeContext({ media: { realisticAi: true, aiVisuals: true, aiVoice: true } });
    expect(checkLabels(labels, qa)).toEqual(failure("youtube_utilisation_ia doit être true"));
  });

  it("étiquettes : contenu de marque si et seulement si partenariat", () => {
    const base = makeReport().etiquettes;
    expect(checkLabels(base, makeContext({ hasPartnership: true }))).toEqual(failure("contenu_de_marque doit être true"));
    expect(checkLabels({ ...base, contenu_de_marque: true }, makeContext())).toEqual(failure("aucun partenariat"));
  });

  it("étiquettes : médias inconnus → rien d'imposé (les points D1 sont déjà ko, non vérifiés)", () => {
    const labels = { tiktok_contenu_ia: false, instagram_contenu_ia: false, youtube_utilisation_ia: false, contenu_de_marque: false };
    expect(checkLabels(labels, makeContext({ media: { realisticAi: null, aiVisuals: null, aiVoice: null } }))).toEqual(ok);
  });

  it("mentions : hypertrucage, partenariat et images virtuelles imposés", () => {
    const realistic = makeContext({ media: { realisticAi: true, aiVisuals: true, aiVoice: true } });
    expect(checkMentions([], realistic)).toEqual(failure("« Images générées par IA »"));
    expect(checkMentions(["Images générées par l'IA"], realistic)).toEqual(ok);
    const partner = makeContext({ hasPartnership: true });
    expect(checkMentions([], partner)).toEqual(failure("« Collaboration commerciale »"));
    expect(checkMentions(["Publicité"], partner)).toEqual(failure("« Images virtuelles »"));
    expect(checkMentions(["Publicité", "Images virtuelles"], partner)).toEqual(ok);
  });
});

describe("agent responsable", () => {
  it.each([
    ["4", "04-scenariste"],
    ["agent 04", "04-scenariste"],
    ["Scénariste", "04-scenariste"],
    ["voix-son", "06-voix-son"],
    ["Voix et son", "06-voix-son"],
    ["08-controle-qualite", "08-controle-qualite"],
    ["10", null],
    ["0", null],
    ["quelqu'un", null],
  ])("« %s » → %s", (value, expected) => {
    expect(canonicalAgent(value)).toBe(expected);
  });

  it("NO_GO : renvoyé à l'agent du premier point bloquant", () => {
    let report = withCheck("E4", koCheck("Boucler", "04-scenariste"));
    report = withCheck("C1", koCheck("Changer de musique", "06-voix-son"), report);
    expect(responsibleAgent(report)).toBe("06-voix-son");
    expect(formatBlockReason(report)).toBe("Contrôle qualité : NO-GO, renvoyé à 06-voix-son. Points ko : C1 : Changer de musique | E4 : Boucler");
  });
});

describe("sources", () => {
  it("D3 et D4 ne dépendent de rien sans partenariat", () => {
    const none = { STORYBOARD: false, PLAN_SONORE: false, TIMELINE: false, TRANSCRIPTION: false, CAPTURES: false };
    expect(missingSourcesFor("D3", none, false)).toEqual([]);
    expect(missingSourcesFor("D4", none, true)).toEqual(["STORYBOARD", "TIMELINE"]);
    expect(missingSourcesFor("B1", none, true)).toEqual([]);
    expect(checksNeeding("TIMELINE", false)).toEqual(["D2", "E1", "E2"]);
  });
});

describe("étiquettes pour les Publications", () => {
  it("une ligne par plateforme, dans la forme des colonnes de Publication", () => {
    const labels = toPublicationLabels({ tiktok_contenu_ia: true, instagram_contenu_ia: false, youtube_utilisation_ia: true, contenu_de_marque: true });
    expect(labels).toEqual({
      TIKTOK: { aiLabel: true, brandedContent: true },
      INSTAGRAM: { aiLabel: false, brandedContent: true },
      YOUTUBE: { aiLabel: true, brandedContent: true },
    });
  });
});
