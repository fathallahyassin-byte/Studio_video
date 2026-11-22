import { describe, expect, it } from "vitest";
import { LICENSED_TRACK, makeLibrary, makeMusicStore, makeOutput, MANUAL_TRACK } from "./fixtures";
import { assertLicensed, chooseTrack, MissingLicenseError, NO_LIBRARY, resolveMusic, type MusicTrack } from "./music";

const brief = makeOutput().musique;
const track = (changes: Partial<MusicTrack>): MusicTrack => ({ ...LICENSED_TRACK, ...changes });

describe("choix d'une piste", () => {
  it("écarte les pistes sans licence ou sans usage commercial", () => {
    const choice = chooseTrack([track({ id: "a", license: null }), track({ id: "b", license: "  " }), track({ id: "c", commercialUse: false })], { bpm: 96, minDurationS: 25 });
    expect(choice).toEqual({ status: "none", unlicensed: 3, total: 3 });
  });

  it("écarte les pistes trop courtes et préfère le tempo le plus proche", () => {
    const choice = chooseTrack([track({ id: "court", durationS: 10, bpm: 96 }), track({ id: "loin", bpm: 140 }), track({ id: "proche", bpm: 92 })], { bpm: 96, minDurationS: 25 });
    expect(choice).toMatchObject({ status: "chosen", track: { id: "proche" } });
  });
});

describe("résolution de la musique", () => {
  it("le choix de l'humain passe avant la banque", async () => {
    const library = makeLibrary();
    const result = await resolveMusic(makeMusicStore(MANUAL_TRACK), library, { videoId: "v", brief, minDurationS: 25 });
    expect(result).toEqual({ status: "manual", track: MANUAL_TRACK });
    expect(library.queries).toEqual([]);
  });

  it("cherche dans la banque avec le brief du modèle", async () => {
    const library = makeLibrary();
    const result = await resolveMusic(makeMusicStore(), library, { videoId: "v", brief, minDurationS: 25 });
    expect(library.queries[0]).toEqual({ keywords: ["curious", "pizzicato"], mood: "curieuse et légère", instruments: ["piano", "pizzicato"], bpm: 96, minDurationS: 25 });
    expect(result).toMatchObject({ status: "library", cost: 0, track: { titre: "Pizzicato curieux", fournisseur: "fausse-banque", source: "banque" } });
  });

  it("banque sans piste sous licence : musique manquante, avec le compte des pistes écartées", async () => {
    const result = await resolveMusic(makeMusicStore(), makeLibrary([track({ license: null })]), { videoId: "v", brief, minDurationS: 25 });
    expect(result).toMatchObject({ status: "missing", reason: expect.stringContaining("1 piste(s) sans licence") });
  });

  it("aucune banque branchée : musique manquante, l'humain la choisit dans le panneau", async () => {
    expect(await resolveMusic(makeMusicStore(), null, { videoId: "v", brief, minDurationS: 25 })).toEqual({ status: "missing", reason: NO_LIBRARY });
  });
});

describe("jamais d'Asset musique sans licence", () => {
  it("le garde-fou refuse une licence vide", () => {
    expect(() => assertLicensed({ titre: "Sans licence", licence: " " })).toThrow(MissingLicenseError);
    expect(() => assertLicensed(MANUAL_TRACK)).not.toThrow();
  });

  it("le magasin refuse d'enregistrer une piste sans licence", async () => {
    const store = makeMusicStore();
    await expect(store.recordTrack("v", { ...MANUAL_TRACK, licence: "" }, 0)).rejects.toThrow(MissingLicenseError);
    expect(store.tracks).toEqual([]);
  });
});
