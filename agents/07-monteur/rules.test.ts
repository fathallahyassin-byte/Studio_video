import { describe, expect, it } from "vitest";
import { clipOf, makeAssets, makeAudioPlan, makeContext, makeTimeline, makeVideo, MEDIA_URLS, MUSIC_URL, VOICE_URL, withClips } from "./fixtures";
import {
  checkAudio,
  checkDuration,
  checkExport,
  checkIdea,
  checkMovement,
  checkPlanOrder,
  checkPlansPlaced,
  checkSubtitles,
  checkTextTrack,
  checkTimeline,
  checkVideoCoverage,
  checkVideoMedia,
  EXPORT,
  MAX_TAIL_S,
  NO_MUSIC_ALERT,
  normalizeTimeline,
  UNMEASURED_VOICE_ALERT,
  videoDuration,
} from "./rules";
import type { Output } from "./schema";
import { inspectSources, requireEditContext } from "./sources";

const context = makeContext();
const normalized = normalizeTimeline(makeTimeline(), context);
const failures = (output: Output) => checkTimeline(output, context).filter((result) => !result.ok);
const reasonOf = (result: { ok: boolean; reason?: string }) => ("reason" in result ? result.reason : "");

describe("durée de la vidéo", () => {
  it("entre la fin du dernier mot et 0,5 s après, sur une image entière", () => {
    expect(videoDuration(12.2, 11.95)).toBe(12.2);
    expect(videoDuration(15, 11.95)).toBe(12.433);
    expect(videoDuration(10, 11.95)).toBe(11.967);
    expect(videoDuration(12.21, 11.95)).toBe(12.2);
  });

  it("ne dépasse jamais 0,5 s après le dernier mot (à l'arrondi près)", () => {
    for (const lastWord of [0.3, 7.01, 11.95, 29.987, 64.4321]) {
      const duration = videoDuration(999, lastWord);
      expect(duration).toBeLessThanOrEqual(lastWord + MAX_TAIL_S + 0.001);
      expect(duration).toBeGreaterThanOrEqual(lastWord - 0.001);
    }
  });
});

describe("normalize", () => {
  it("impose l'export 1080×1920 à 30 i/s, H.264, AAC 48 kHz", () => {
    expect(normalized.export).toEqual({ largeur: 1080, hauteur: 1920, fps: 30, codec: "h264", audio: "aac_48k" });
    expect(EXPORT).toEqual(normalized.export);
  });

  it("ramène la durée dans la fenêtre et le signale en alerte", () => {
    const long = normalizeTimeline(withClips((clips) => clips.map((clip) => (clip.plan === "P04" ? { ...clip, fin_s: 14 } : clip)), makeTimeline({ duree_totale_s: 14 })), context);
    expect(long.duree_totale_s).toBe(12.433);
    expect(long.pistes.video.at(-1)?.fin_s).toBe(12.433);
    expect(long.alertes.some((alert) => alert.startsWith("Durée ramenée en code de 14 s à 12.43 s"))).toBe(true);
  });

  it("remplace les sous-titres du modèle par ceux recalés sur l'horodatage", () => {
    const fromModel = makeTimeline({ pistes: { ...makeTimeline().pistes, sous_titres: [{ mots: "inventé", debut_s: 0, fin_s: 9, mot_actif: "inventé" }] } });
    const result = normalizeTimeline(fromModel, context);
    expect(result.pistes.sous_titres).toHaveLength(24);
    expect(result.pistes.sous_titres[0]).toEqual({ mots: "Ton trombone cache un", debut_s: 0, fin_s: 0.5, mot_actif: "Ton" });
  });

  it("construit la piste audio : voix fournie, musique sous licence au niveau et ducking du plan sonore", () => {
    const fromModel = makeTimeline({
      pistes: { ...makeTimeline().pistes, audio: [{ type: "voix", src: "https://invente.test/voix.mp3", debut_s: 0.4, volume_db: 3, ducking: true }, { type: "effet", src: "https://invente.test/whoosh.wav", debut_s: 3, volume_db: -6, ducking: false }] },
    });
    expect(normalizeTimeline(fromModel, context).pistes.audio).toEqual([
      { type: "voix", src: VOICE_URL, debut_s: 0, volume_db: 0, ducking: false },
      { type: "musique", src: MUSIC_URL, debut_s: 0, volume_db: -20, ducking: true },
    ]);
  });

  it("fichiers des plans tirés des Asset : jamais une URL inventée, manquant quand il n'y en a pas", () => {
    const invented = withClips((clips) => clips.map((clip) => ({ ...clip, src: `https://invente.test/${clip.plan}.mp4` })));
    const withoutP03 = makeContext(makeVideo(), makeAssets().filter((asset) => asset.planId !== "P03"));
    const result = normalizeTimeline(invented, withoutP03);
    expect(result.pistes.video.map((clip) => [clip.plan, clip.src, clip.manquant])).toEqual([
      ["P01", "", false],
      ["P02", MEDIA_URLS.P02, false],
      ["P03", "", true],
      ["P04", MEDIA_URLS.P04, false],
    ]);
    expect(result.alertes).toContain("Média manquant pour P03 : à fournir avant le rendu.");
  });

  it("referme les petits écarts d'arrondi et prolonge le dernier plan jusqu'à la fin", () => {
    const sloppy = withClips(() => [
      { ...clipOf("P01"), debut_s: 0.02, fin_s: 2.5 },
      { ...clipOf("P02"), debut_s: 2.53, fin_s: 6 },
      { ...clipOf("P03"), debut_s: 5.98, fin_s: 9 },
      { ...clipOf("P04"), debut_s: 9, fin_s: 11.9 },
    ]);
    const result = normalizeTimeline(sloppy, context);
    expect(result.pistes.video.map((clip) => [clip.debut_s, clip.fin_s])).toEqual([
      [0, 2.5],
      [2.5, 6],
      [6, 9],
      [9, 12.2],
    ]);
    expect(failures(result)).toEqual([]);
  });

  it("coupe ce qui dépasse la fin (texte compris) et cale les temps sur l'image", () => {
    const result = normalizeTimeline(makeTimeline({ pistes: { ...makeTimeline().pistes, texte: [{ texte: "Fin", debut_s: 11.01, fin_s: 13, position: "bas_zone_sure", animation: "pop" }, { texte: "Trop tard", debut_s: 12.5, fin_s: 13, position: "centre", animation: "pop" }] } }), context);
    expect(result.pistes.texte).toEqual([{ texte: "Fin", debut_s: 11, fin_s: 12.2, position: "bas_zone_sure", animation: "pop" }]);
  });

  it("alertes en code : musique absente, effets non placés, durée de voix non mesurée (sans doublon)", () => {
    const video = makeVideo({ audio: { ...makeAudioPlan(), production: { voix: { url: VOICE_URL, mots: makeContext().words.map((word) => ({ word: word.text, startS: word.startS, endS: word.endS })) } } } });
    const bare = requireEditContext(inspectSources(video, makeAssets()));
    const result = normalizeTimeline(makeTimeline({ alertes: [NO_MUSIC_ALERT, "  "] }), bare);
    expect(result.alertes).toEqual([NO_MUSIC_ALERT, "1 effet(s) sonore(s) du plan sonore non placé(s) : aucun fichier d'effet n'est disponible.", UNMEASURED_VOICE_ALERT]);
    expect(result.pistes.audio).toEqual([{ type: "voix", src: VOICE_URL, debut_s: 0, volume_db: 0, ducking: false }]);
  });

  it("une sortie normalisée conforme passe tous les contrôles", () => {
    expect(failures(normalized)).toEqual([]);
  });
});

describe("contrôles", () => {
  it("idee_id identique au storyboard", () => {
    expect(reasonOf(checkIdea({ ...normalized, idee_id: "I-99" }, context))).toContain("« I-99 » différent");
  });

  it("export 1080×1920 à 30 i/s", () => {
    const wrong = { ...normalized, export: { ...normalized.export, fps: 25 } };
    // @ts-expect-error : le schéma interdit déjà 25 i/s ; le contrôle reste un garde-fou.
    expect(checkExport(wrong).ok).toBe(false);
  });

  it("durée : ni coupée avant le dernier mot, ni plus de 0,5 s après", () => {
    expect(reasonOf(checkDuration({ ...normalized, duree_totale_s: 11.5 }, context))).toContain("coupe la voix");
    expect(reasonOf(checkDuration({ ...normalized, duree_totale_s: 12.5 }, context))).toContain("plus de 0.5 s après le dernier mot (11.95 s)");
    expect(checkDuration({ ...normalized, duree_totale_s: 12.45 }, context).ok).toBe(true);
  });

  it("chaque plan du storyboard est placé, aucun plan inconnu", () => {
    const result = checkPlansPlaced(withClips((clips) => [...clips.filter((clip) => clip.plan !== "P03"), { ...clipOf("P01", normalized), plan: "P09" }], normalized), context);
    expect(reasonOf(result)).toContain("absents de la piste vidéo (ou placés après la fin) : P03");
    expect(reasonOf(result)).toContain("plans inconnus du storyboard : P09");
  });

  it("un plan placé après la fin disparaît au normalize, puis est refusé", () => {
    const late = withClips((clips) => clips.map((clip) => (clip.plan === "P04" ? { ...clip, debut_s: 12.3, fin_s: 13 } : clip)), makeTimeline());
    const reasons = failures(normalizeTimeline(late, context)).map(reasonOf).join("\n");
    expect(reasons).toContain("absents de la piste vidéo (ou placés après la fin) : P04");
  });

  it("ordre du storyboard respecté", () => {
    const swapped = withClips(() => [clipOf("P01", normalized), { ...clipOf("P03", normalized), debut_s: 2.5, fin_s: 6 }, { ...clipOf("P02", normalized), debut_s: 6, fin_s: 9 }, clipOf("P04", normalized)], normalized);
    expect(reasonOf(checkPlanOrder(swapped, context))).toContain("P01, P03, P02, P04 au lieu de P01, P02, P03, P04");
  });

  it("pas de trou, pas de chevauchement, de 0 à la fin, aucune durée nulle", () => {
    const gap = withClips((clips) => clips.map((clip) => (clip.plan === "P03" ? { ...clip, debut_s: 6.5 } : clip)), normalized);
    expect(reasonOf(checkVideoCoverage(gap))).toContain("trou de 0.5 s entre P02 et P03");
    const overlap = withClips((clips) => clips.map((clip) => (clip.plan === "P03" ? { ...clip, debut_s: 5.5 } : clip)), normalized);
    expect(reasonOf(checkVideoCoverage(overlap))).toContain("chevauchement de 0.5 s entre P02 et P03");
    const late = withClips((clips) => clips.map((clip) => (clip.plan === "P01" ? { ...clip, debut_s: 1 } : clip)), normalized);
    expect(reasonOf(checkVideoCoverage(late))).toContain("commence à 1 s");
    const short = withClips((clips) => clips.map((clip) => (clip.plan === "P04" ? { ...clip, fin_s: 11 } : clip)), normalized);
    expect(reasonOf(checkVideoCoverage(short))).toContain("finit à 11 s au lieu de 12.2 s");
    const empty = withClips((clips) => clips.map((clip) => (clip.plan === "P02" ? { ...clip, fin_s: clip.debut_s } : clip)), normalized);
    expect(reasonOf(checkVideoCoverage(empty))).toContain("P02 a une durée nulle");
    expect(reasonOf(checkVideoCoverage(withClips(() => [], normalized)))).toBe("Piste vidéo vide.");
  });

  it("aucun plan fixe de plus de 3 s sans mouvement", () => {
    const still = withClips((clips) => clips.map((clip) => (clip.plan === "P04" ? { ...clip, mouvement: "fixe" } : clip)), normalized);
    expect(reasonOf(checkMovement(still))).toContain("P04 (3.2 s)");
    const shortStill = withClips((clips) => clips.map((clip) => (clip.plan === "P03" ? { ...clip, mouvement: "" } : clip)), normalized);
    expect(checkMovement(shortStill).ok).toBe(true);
  });

  it("médias référencés : seulement les fichiers fournis, manquant cohérent", () => {
    const invented = withClips((clips) => clips.map((clip) => (clip.plan === "P02" ? { ...clip, src: "https://invente.test/p02.mp4" } : clip)), normalized);
    expect(reasonOf(checkVideoMedia(invented, context))).toContain("P02 référence un fichier qui n'est pas dans les médias fournis");
    const textWithFile = withClips((clips) => clips.map((clip) => (clip.plan === "P01" ? { ...clip, src: MEDIA_URLS.P02 } : clip)), normalized);
    expect(reasonOf(checkVideoMedia(textWithFile, context))).toContain("P01 est un texte animé");
    const wronglyMissing = withClips((clips) => clips.map((clip) => (clip.plan === "P03" ? { ...clip, src: "", manquant: true } : clip)), normalized);
    expect(reasonOf(checkVideoMedia(wronglyMissing, context))).toContain("P03 est marqué manquant alors que son fichier existe");
  });

  it("textes : durée positive, dans la vidéo", () => {
    const bad = { ...normalized, pistes: { ...normalized.pistes, texte: [{ texte: "x", debut_s: 2, fin_s: 2, position: "centre", animation: "pop" }, { texte: "y", debut_s: 12, fin_s: 13, position: "centre", animation: "pop" }] } };
    expect(reasonOf(checkTextTrack(bad))).toBe("Piste texte : texte n° 1 de durée nulle ou négative ; texte n° 2 dépasse la fin de la vidéo.");
  });

  it("sous-titres : un par mot, sans chevauchement, 4 mots au plus par groupe", () => {
    const cues = normalized.pistes.sous_titres;
    const missing = { ...normalized, pistes: { ...normalized.pistes, sous_titres: cues.slice(1) } };
    expect(reasonOf(checkSubtitles(missing, context))).toContain("23 entrées pour 24 mots prononcés");
    const overlapping = { ...normalized, pistes: { ...normalized.pistes, sous_titres: cues.map((cue, index) => (index === 0 ? { ...cue, fin_s: 0.8 } : cue)) } };
    expect(reasonOf(checkSubtitles(overlapping, context))).toContain("sous-titres n° 1 et 2 se chevauchent");
    const long = { ...normalized, pistes: { ...normalized.pistes, sous_titres: cues.map((cue, index) => (index === 0 ? { ...cue, mots: "un deux trois quatre cinq" } : cue)) } };
    expect(reasonOf(checkSubtitles(long, context))).toContain("groupe de plus de 4 mots");
  });

  it("audio : une voix fournie à 0 s, aucun fichier non fourni", () => {
    const twoVoices = { ...normalized, pistes: { ...normalized.pistes, audio: [...normalized.pistes.audio, { type: "voix" as const, src: VOICE_URL, debut_s: 0, volume_db: 0, ducking: false }] } };
    expect(reasonOf(checkAudio(twoVoices, context))).toContain("une seule piste voix");
    const effect = { ...normalized, pistes: { ...normalized.pistes, audio: [...normalized.pistes.audio, { type: "effet" as const, src: "https://invente.test/whoosh.wav", debut_s: 3, volume_db: -6, ducking: false }] } };
    expect(reasonOf(checkAudio(effect, context))).toContain("effet avec un fichier non fourni");
  });

  it("checkTimeline renvoie tous les refus d'un bloc", () => {
    const broken = withClips((clips) => clips.map((clip) => (clip.plan === "P03" ? { ...clip, debut_s: 6.5, mouvement: "fixe", fin_s: 10 } : clip)), { ...normalized, idee_id: "autre" });
    expect(failures(broken).length).toBeGreaterThanOrEqual(3);
  });
});
