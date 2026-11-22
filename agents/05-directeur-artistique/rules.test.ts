import { describe, expect, it } from "vitest";
import type { ControlResult } from "@/agents/_shared/types";
import { makePlan, makeScript, makeStoryboard, STYLE_SUFFIX, withPlan } from "./fixtures";
import { checkCoverage, checkStoryboard, computeVideoAiSeconds, normalizeStoryboard, type StoryboardContext } from "./rules";
import type { Output } from "./schema";
import { scriptBeats, scriptEnd } from "./variables";

const script = makeScript();
const context: StoryboardContext = {
  ideaId: "I-07",
  beats: scriptBeats(script),
  scriptEndS: scriptEnd(script),
  videoAiBudgetS: 12,
  tools: { image: true, video: true },
  styleSuffix: STYLE_SUFFIX,
};

const reasons = (results: ControlResult[]) => results.flatMap((result) => (result.ok ? [] : [result.reason]));
const check = (storyboard: Output, overrides: Partial<StoryboardContext> = {}) => reasons(checkStoryboard(normalizeStoryboard(storyboard), { ...context, ...overrides }));

describe("normalizeStoryboard", () => {
  it("recalcule secondes_video_ia à partir des plans video_ia, quelle que soit la valeur du modèle", () => {
    expect(normalizeStoryboard(makeStoryboard({ secondes_video_ia: 0 })).secondes_video_ia).toBe(6);
    expect(normalizeStoryboard(makeStoryboard({ secondes_video_ia: 99 })).secondes_video_ia).toBe(6);
  });

  it("arrondit au dixième et ignore les autres types", () => {
    const plans = [makePlan("P01", 1, 0, 2.33, "video_ia"), makePlan("P02", 1, 2.33, 3, "image_ia_animee"), makePlan("P03", 2, 3, 6.5, "stock")];
    expect(computeVideoAiSeconds(plans)).toBe(2.3);
  });

  it("trie les plans dans l'ordre du temps", () => {
    const shuffled = makeStoryboard({ plans: [...makeStoryboard().plans].reverse() });
    expect(normalizeStoryboard(shuffled).plans.map((plan) => plan.id)).toEqual(["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08"]);
  });

  it("retire le label IA des plans non générés, garde celui des plans générés", () => {
    const storyboard = withPlan("P03", { label_ia_requis: true }, withPlan("P04", { label_ia_requis: true }, withPlan("P02", { label_ia_requis: true })));
    const plans = normalizeStoryboard(storyboard).plans;
    expect(plans.find((plan) => plan.id === "P03")?.label_ia_requis).toBe(false);
    expect(plans.find((plan) => plan.id === "P04")?.label_ia_requis).toBe(false);
    expect(plans.find((plan) => plan.id === "P02")?.label_ia_requis).toBe(true);
  });
});

describe("checkStoryboard", () => {
  it("accepte le storyboard d'exemple", () => {
    expect(check(makeStoryboard())).toEqual([]);
  });

  it("couverture : trou au milieu", () => {
    expect(check(withPlan("P03", { debut_s: 6 }))).toContainEqual(expect.stringContaining("Trou de 0.5 s entre P02"));
  });

  it("couverture : chevauchement", () => {
    expect(check(withPlan("P03", { debut_s: 5 }))).toContainEqual(expect.stringContaining("P03 chevauche P02"));
  });

  it("couverture : trou au début", () => {
    expect(check(withPlan("P01", { debut_s: 0.5 }))).toContainEqual(expect.stringContaining("Trou au début"));
  });

  it("couverture : plans qui s'arrêtent avant la fin du script", () => {
    const storyboard = makeStoryboard({ plans: makeStoryboard().plans.filter((plan) => plan.id !== "P08") });
    expect(check(storyboard)).toContainEqual(expect.stringContaining("Trou à la fin : le dernier plan (P07) finit à 22 s, le script dure 25 s"));
  });

  it("couverture : plan au-delà de la fin du script", () => {
    expect(check(withPlan("P08", { fin_s: 26 }))).toContainEqual(expect.stringContaining("P08 finit à 26 s, après la fin du script (25 s)"));
  });

  it("couverture : tolère les arrondis du modèle (0,05 s)", () => {
    expect(reasons(checkCoverage(withPlan("P03", { debut_s: 5.54 }).plans, 25))).toEqual([]);
  });

  it("durée d'un plan hors de 1,5 à 4 s", () => {
    const storyboard = makeStoryboard({ plans: [...makeStoryboard().plans.slice(0, 4), makePlan("P05", 3, 11, 12, "image_ia_animee"), makePlan("P09", 3, 12, 15, "stock"), ...makeStoryboard().plans.slice(5)] });
    expect(check(storyboard)).toContainEqual(expect.stringContaining("P05 dure 1 s"));
    expect(check(withPlan("P05", { debut_s: 11, fin_s: 11 }))).toContainEqual(expect.stringContaining("doit être après debut_s"));
  });

  it("plan hors de son beat ou sur un beat absent", () => {
    expect(check(withPlan("P04", { beat: 2 }))).toContainEqual(expect.stringContaining("P04 (8 s à 11 s) sort du beat 2"));
    expect(check(withPlan("P04", { beat: 9 }))).toContainEqual(expect.stringContaining("beat 9, absent du script"));
  });

  it("ids de plans en double et couverture inconnue", () => {
    expect(check(withPlan("P02", { id: "P01" }))).toContainEqual("L'id de plan P01 est utilisé plusieurs fois.");
    expect(check(makeStoryboard({ couverture: { plan: "P42", texte: "x" } }))).toContainEqual(expect.stringContaining("couverture.plan (P42)"));
  });

  it("idee_id différent de celui du script", () => {
    expect(check(makeStoryboard({ idee_id: "I-99" }))).toContainEqual(expect.stringContaining("idee_id vaut « I-99 »"));
  });

  it("dépassement du budget de vidéo IA : refus renvoyé au modèle avec le total recalculé", () => {
    const storyboard = withPlan("P05", { type: "video_ia" }, withPlan("P06", { type: "video_ia" }));
    expect(check(storyboard)).toContainEqual(expect.stringContaining("Vidéo IA : 13.5 s pour un budget de 12 s (plans P01, P05, P06, P08)"));
    expect(check(makeStoryboard(), { videoAiBudgetS: 6 })).toEqual([]);
    expect(check(makeStoryboard(), { videoAiBudgetS: 5 })).toContainEqual(expect.stringContaining("6 s pour un budget de 5 s"));
  });

  it("types interdits quand l'outil n'est pas branché", () => {
    const results = check(makeStoryboard(), { tools: { image: false, video: false } });
    expect(results).toContainEqual(expect.stringContaining("P01 est de type video_ia, mais aucun modèle vidéo IA"));
    expect(results).toContainEqual(expect.stringContaining("P02 est de type image_ia_animee, mais aucun modèle image IA"));
  });

  it("plans générés : prompt, mention 9:16, suffixe de style et prompt négatif obligatoires", () => {
    expect(check(withPlan("P02", { prompt_en: null }))).toContainEqual("P02 (image_ia_animee) : prompt_en manquant.");
    expect(check(withPlan("P02", { prompt_en: "a paperclip", negative_prompt_en: " " }))).toContainEqual(
      `P02 (image_ia_animee) : prompt_en sans « vertical 9:16 composition » ; prompt_en sans le suffixe de style de la bible (« ${STYLE_SUFFIX} ») ; negative_prompt_en manquant.`,
    );
  });

  it("suffixe de style comparé sans casse ni point final, et ignoré si la bible n'en a pas", () => {
    const loose = withPlan("P02", { prompt_en: "A paperclip, Vertical 9:16 Composition, FLAT PASTEL illustration,  soft light." });
    expect(check(loose)).toEqual([]);
    expect(check(withPlan("P02", { prompt_en: "a paperclip, vertical 9:16 composition" }), { styleSuffix: null })).toEqual([]);
  });

  it("stock sans mots-clés, texte animé sans texte", () => {
    expect(check(withPlan("P03", { mots_cles_stock: [""] }))).toContainEqual("P03 (stock) : mots_cles_stock vide.");
    expect(check(withPlan("P04", { texte_ecran: " " }))).toContainEqual("P04 (texte_anime) : texte_ecran vide pour un texte animé.");
  });
});
