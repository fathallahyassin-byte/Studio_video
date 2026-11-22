import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listTemplateVariables } from "@/lib/agents/template";
import { makeAssets, makeContext, makeTimeline, makeVideo, MEDIA_URLS, VOICE_URL } from "./fixtures";
import { buildPromptVariables, CORRECTION_HEADING, ENGINE_SCHEMA, formatMedia, formatWordTimings, SUBTITLES_IN_CODE } from "./variables";

const PROMPT = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
const context = makeContext();

describe("variables du prompt", () => {
  it("une valeur pour chaque {{VARIABLE}} du prompt, sauf BIBLE", () => {
    const expected = listTemplateVariables(PROMPT).filter((name) => name !== "BIBLE").sort();
    expect(Object.keys(buildPromptVariables(context, null, null)).sort()).toEqual(expected);
  });

  it("voix et durée mesurée", () => {
    const variables = buildPromptVariables(context, null, null);
    expect(variables.URL_VOIX).toBe(VOICE_URL);
    expect(variables.DUREE_VOIX_S).toBe("12.1");
  });

  it("horodatage nettoyé, sous-titres faits en code et fenêtre de fin", () => {
    const text = formatWordTimings(context);
    expect(text).toContain('{"mot":"Ton","debut_s":0,"fin_s":0.45}');
    expect(text).toContain(SUBTITLES_IN_CODE);
    expect(text).toContain("Dernier mot à 11.95 s : duree_totale_s entre 11.95 et 12.45 s");
  });

  it("médias : URL enregistrée, texte animé sans fichier, MANQUANT sinon (jamais d'URL à inventer)", () => {
    const withoutStock = makeContext(makeVideo(), makeAssets().filter((asset) => asset.planId !== "P02"));
    const text = formatMedia(withoutStock);
    expect(text).toContain('- P01 → aucun fichier : texte animé dessiné par le moteur ("src": "", "manquant": false)');
    expect(text).toContain('- P02 → MANQUANT (séquence libre de droits pas encore sourcée) : "src": "", "manquant": true');
    expect(text).toContain(`- P03 → ${MEDIA_URLS.P03} (image)`);
    expect(text).toContain(`- P04 → ${MEDIA_URLS.P04} (vidéo)`);
  });

  it("plan sonore : musique fournie ou non, effets sans fichier", () => {
    const variables = buildPromptVariables(context, null, null);
    expect(variables.PLAN_SONORE).toContain('"musique_sous_voix_db": -20');
    expect(variables.PLAN_SONORE).toContain("Musique sous licence fournie : https://media.test/musique.mp3");
    expect(variables.PLAN_SONORE).toContain("Aucun fichier d'effet sonore n'est fourni");
    const silent = buildPromptVariables({ ...context, music: null }, null, null);
    expect(silent.PLAN_SONORE).toContain("Aucune musique sous licence n'est fournie");
  });

  it("schéma moteur explicite tant qu'aucune composition Remotion n'existe", () => {
    expect(buildPromptVariables(context, null, null).SCHEMA_MOTEUR).toBe(ENGINE_SCHEMA);
    expect(ENGINE_SCHEMA).toContain("aucune composition Remotion n'est encore branchée");
    expect(ENGINE_SCHEMA).toContain("1080×1920, 30 images/s");
  });

  it("note de l'humain : sous un intitulé clair dans {{STORYBOARD}}, avec la timeline précédente", () => {
    const storyboard = buildPromptVariables(context, "  Coupes trop lentes au début. ", makeTimeline({ alertes: ["version 1"] })).STORYBOARD ?? "";
    expect(storyboard).toContain(`${CORRECTION_HEADING} :\nCoupes trop lentes au début.`);
    expect(storyboard).toContain("Timeline précédente, à corriger selon cette note");
    expect(storyboard).toContain("version 1");
    expect(buildPromptVariables(context, "   ", null).STORYBOARD).not.toContain(CORRECTION_HEADING);
  });
});
