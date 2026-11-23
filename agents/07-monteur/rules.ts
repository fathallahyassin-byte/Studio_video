import type { ControlResult } from "@/agents/_shared/types";
import { FPS, frameOf, HEIGHT, secondsOf, snap, WIDTH } from "./frames";
import type { Output } from "./schema";
import { needsFile, type EditContext } from "./sources";
import { buildSubtitles, MAX_WORDS_PER_GROUP } from "./subtitles";

// Règles du monteur, en code (fonctions pures). normalize impose ce qui ne dépend pas du goût du modèle
// (format, durée, sous-titres, pistes audio, fichiers des plans) ; controls refuse le reste et le renvoie au modèle.

export type VideoClip = Output["pistes"]["video"][number];
export type TextClip = Output["pistes"]["texte"][number];
export type SubtitleClip = Output["pistes"]["sous_titres"][number];
export type AudioClip = Output["pistes"]["audio"][number];

/** Prompt : « la vidéo s'arrête au plus 0,5 s après le dernier mot ». */
export const MAX_TAIL_S = 0.5;
/** Prompt : « aucun plan fixe de plus de 3 s sans mouvement ». */
export const MAX_STATIC_S = 3;
/** Écart toléré entre deux bornes de plans (arrondis du modèle), soit environ une image et demie. */
export const TOLERANCE_S = 0.05;
/** Arrondi au millième des temps calés sur l'image. */
const ROUNDING_S = 0.001;

export const EXPORT: Output["export"] = { largeur: WIDTH, hauteur: HEIGHT, fps: FPS, codec: "h264", audio: "aac_48k" };

const STATIC_MOVES = /^(|aucun|aucune|fixe|statique|static|none|immobile)$/i;

const seconds = (value: number) => String(Math.round(value * 100) / 100);

// ---------------------------------------------------------------------------
// Durée : entre la fin du dernier mot et 0,5 s après, sur une image entière.
// ---------------------------------------------------------------------------

export function videoDuration(requestedS: number, lastWordEndS: number): number {
  const minFrames = Math.ceil(lastWordEndS * FPS - 1e-6);
  const maxFrames = Math.floor((lastWordEndS + MAX_TAIL_S) * FPS + 1e-6);
  const frames = Math.min(Math.max(frameOf(requestedS), minFrames), maxFrames);
  return secondsOf(Math.max(frames, 1));
}

// ---------------------------------------------------------------------------
// Pistes.
// ---------------------------------------------------------------------------

/** Bornes calées sur l'image, coupées à la fin de la vidéo ; ce qui commence après la fin disparaît. */
export function fitSpans<T extends { debut_s: number; fin_s: number }>(spans: readonly T[], durationS: number): T[] {
  return spans
    .map((span) => ({ ...span, debut_s: snap(span.debut_s), fin_s: Math.min(snap(span.fin_s), durationS) }))
    .filter((span) => span.debut_s < durationS)
    .sort((a, b) => a.debut_s - b.debut_s || a.fin_s - b.fin_s);
}

/** Petits écarts d'arrondi refermés : départ à 0, plans bout à bout, dernier plan jusqu'à la fin (au plus 0,5 s ajoutée). */
function closeSmallGaps(clips: readonly VideoClip[], durationS: number): VideoClip[] {
  const closed = clips.map((clip, index) => {
    const previous = clips[index - 1];
    const debut_s = previous === undefined ? (clip.debut_s <= TOLERANCE_S ? 0 : clip.debut_s) : Math.abs(clip.debut_s - previous.fin_s) <= TOLERANCE_S ? previous.fin_s : clip.debut_s;
    return { ...clip, debut_s };
  });
  const last = closed.at(-1);
  if (last && durationS - last.fin_s > 0 && durationS - last.fin_s <= MAX_TAIL_S + TOLERANCE_S) closed[closed.length - 1] = { ...last, fin_s: durationS };
  return closed;
}

/** Le fichier d'un plan vient des Asset, jamais du modèle : URL enregistrée, ou "" et manquant. */
function withMedia(clip: VideoClip, context: EditContext): VideoClip {
  const plan = context.plans.find((entry) => entry.id === clip.plan);
  if (plan && !needsFile(plan)) return { ...clip, src: "", manquant: false };
  const media = context.media.find((entry) => entry.planId === clip.plan);
  return media ? { ...clip, src: media.url, manquant: false } : { ...clip, src: "", manquant: true };
}

export function normalizeVideoTrack(clips: readonly VideoClip[], context: EditContext, durationS: number): VideoClip[] {
  return closeSmallGaps(fitSpans(clips, durationS), durationS).map((clip) => withMedia(clip, context));
}

/** Voix à 0 dB dès 0 s ; musique sous licence au niveau et avec le ducking du plan sonore. Les effets sans fichier ne sont pas placés. */
export function buildAudioTrack(context: EditContext): AudioClip[] {
  const voice: AudioClip = { type: "voix", src: context.voice.url, debut_s: 0, volume_db: 0, ducking: false };
  if (!context.music) return [voice];
  const { mixage } = context.audioPlan;
  const music: AudioClip = { type: "musique", src: context.music.url, debut_s: 0, volume_db: mixage.musique_sous_voix_db, ducking: mixage.ducking };
  return [voice, music];
}

// ---------------------------------------------------------------------------
// Alertes ajoutées en code.
// ---------------------------------------------------------------------------

export function missingPlanIds(timeline: Pick<Output, "pistes">): string[] {
  return [...new Set(timeline.pistes.video.filter((clip) => clip.manquant).map((clip) => clip.plan))];
}

export function missingMediaAlert(planIds: readonly string[]): string {
  return `Média manquant pour ${planIds.join(", ")} : à fournir avant le rendu.`;
}

export const NO_MUSIC_ALERT = "Aucune musique sous licence enregistrée : montage sans musique.";

function codeAlerts(output: Output, normalized: Output, context: EditContext): string[] {
  const missing = missingPlanIds(normalized);
  const effects = context.audioPlan.effets.length;
  const changed = Math.abs(output.duree_totale_s - normalized.duree_totale_s) > TOLERANCE_S;
  return [
    missing.length > 0 ? missingMediaAlert(missing) : null,
    context.music ? null : NO_MUSIC_ALERT,
    effects > 0 ? `${effects} effet(s) sonore(s) du plan sonore non placé(s) : aucun fichier d'effet n'est disponible.` : null,
    changed
      ? `Durée ramenée en code de ${seconds(output.duree_totale_s)} s à ${seconds(normalized.duree_totale_s)} s (dernier mot à ${seconds(context.lastWordEndS)} s, fin au plus ${MAX_TAIL_S} s après).`
      : null,
  ].filter((alert) => alert !== null);
}

function mergeAlerts(...lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat().map((alert) => alert.trim()).filter((alert) => alert !== ""))];
}

/**
 * Recalculs en code : format d'export, durée (fin ≤ 0,5 s après le dernier mot), temps calés sur l'image,
 * sous-titres recalés sur l'horodatage, pistes audio et fichiers des plans tirés des sources. Le modèle ne choisit
 * que le rythme (découpe, mouvements, textes) et les transitions.
 */
export function normalizeTimeline(output: Output, context: EditContext): Output {
  const durationS = videoDuration(output.duree_totale_s, context.lastWordEndS);
  const normalized: Output = {
    ...output,
    idee_id: output.idee_id.trim(),
    duree_totale_s: durationS,
    export: EXPORT,
    pistes: {
      video: normalizeVideoTrack(output.pistes.video, context, durationS),
      texte: fitSpans(output.pistes.texte, durationS),
      sous_titres: buildSubtitles(context.words, durationS),
      audio: buildAudioTrack(context),
    },
  };
  return { ...normalized, alertes: mergeAlerts(output.alertes, codeAlerts(output, normalized, context)) };
}

// ---------------------------------------------------------------------------
// Contrôles : chaque refus est renvoyé au modèle.
// ---------------------------------------------------------------------------

const ok: ControlResult = { ok: true };
const fail = (reason: string): ControlResult => ({ ok: false, reason });

export function checkIdea(output: Output, context: EditContext): ControlResult {
  return output.idee_id === context.ideaId ? ok : fail(`idee_id « ${output.idee_id} » différent de celui du storyboard (« ${context.ideaId} »).`);
}

export function checkPlansPlaced(output: Output, context: EditContext): ControlResult {
  const placed = new Set(output.pistes.video.map((clip) => clip.plan));
  const known = new Set(context.plans.map((plan) => plan.id));
  const absent = context.plans.filter((plan) => !placed.has(plan.id)).map((plan) => plan.id);
  const unknown = [...placed].filter((id) => !known.has(id));
  const problems = [
    absent.length > 0 ? `plans du storyboard absents de la piste vidéo (ou placés après la fin) : ${absent.join(", ")}` : null,
    unknown.length > 0 ? `plans inconnus du storyboard : ${unknown.join(", ")}` : null,
  ].filter((problem) => problem !== null);
  return problems.length === 0 ? ok : fail(`Piste vidéo : ${problems.join(" ; ")}.`);
}

export function checkPlanOrder(output: Output, context: EditContext): ControlResult {
  const expected = context.plans.map((plan) => plan.id);
  const firstSeen = [...new Set(output.pistes.video.map((clip) => clip.plan))].filter((id) => expected.includes(id));
  const order = expected.filter((id) => firstSeen.includes(id));
  return firstSeen.every((id, index) => id === order[index]) ? ok : fail(`Les plans ne suivent pas l'ordre du storyboard : ${firstSeen.join(", ")} au lieu de ${order.join(", ")}.`);
}

function coverageProblems(clips: readonly VideoClip[], durationS: number): string[] {
  const problems: string[] = [];
  const first = clips[0];
  if (first && first.debut_s > TOLERANCE_S) problems.push(`la piste commence à ${seconds(first.debut_s)} s au lieu de 0 s`);
  clips.forEach((clip, index) => {
    if (clip.fin_s - clip.debut_s <= 0) problems.push(`${clip.plan} a une durée nulle ou négative (${seconds(clip.debut_s)}–${seconds(clip.fin_s)} s)`);
    const next = clips[index + 1];
    if (!next) return;
    const gap = next.debut_s - clip.fin_s;
    if (gap > TOLERANCE_S) problems.push(`trou de ${seconds(gap)} s entre ${clip.plan} et ${next.plan}`);
    if (gap < -TOLERANCE_S) problems.push(`chevauchement de ${seconds(-gap)} s entre ${clip.plan} et ${next.plan}`);
  });
  const last = clips.at(-1);
  if (last && Math.abs(last.fin_s - durationS) > TOLERANCE_S) problems.push(`la piste finit à ${seconds(last.fin_s)} s au lieu de ${seconds(durationS)} s`);
  return problems;
}

export function checkVideoCoverage(output: Output): ControlResult {
  if (output.pistes.video.length === 0) return fail("Piste vidéo vide.");
  const problems = coverageProblems(output.pistes.video, output.duree_totale_s);
  return problems.length === 0 ? ok : fail(`Piste vidéo : ${problems.join(" ; ")}.`);
}

export function checkMovement(output: Output): ControlResult {
  const still = output.pistes.video.filter((clip) => clip.fin_s - clip.debut_s > MAX_STATIC_S + TOLERANCE_S && STATIC_MOVES.test(clip.mouvement.trim()));
  if (still.length === 0) return ok;
  return fail(`Plan fixe de plus de ${MAX_STATIC_S} s sans mouvement : ${still.map((clip) => `${clip.plan} (${seconds(clip.fin_s - clip.debut_s)} s)`).join(", ")}. Ajoute un zoom, un panoramique ou un élément animé.`);
}

function mediaProblem(clip: VideoClip, context: EditContext): string | null {
  const plan = context.plans.find((entry) => entry.id === clip.plan);
  if (!plan) return null;
  if (!needsFile(plan)) return clip.src === "" ? null : `${clip.plan} est un texte animé : src doit être ""`;
  const media = context.media.find((entry) => entry.planId === clip.plan);
  if (clip.manquant) return media ? `${clip.plan} est marqué manquant alors que son fichier existe` : clip.src === "" ? null : `${clip.plan} est manquant : src doit être ""`;
  return media && clip.src === media.url ? null : `${clip.plan} référence un fichier qui n'est pas dans les médias fournis`;
}

export function checkVideoMedia(output: Output, context: EditContext): ControlResult {
  const problems = output.pistes.video.map((clip) => mediaProblem(clip, context)).filter((problem) => problem !== null);
  return problems.length === 0 ? ok : fail(`Médias : ${problems.join(" ; ")}. N'utilise que les médias fournis.`);
}

function spanProblems(label: string, spans: readonly { debut_s: number; fin_s: number }[], durationS: number): string[] {
  return spans.flatMap((span, index) => {
    if (span.fin_s - span.debut_s <= 0) return [`${label} n° ${index + 1} de durée nulle ou négative`];
    if (span.fin_s > durationS + ROUNDING_S) return [`${label} n° ${index + 1} dépasse la fin de la vidéo`];
    return [];
  });
}

export function checkTextTrack(output: Output): ControlResult {
  const problems = spanProblems("texte", output.pistes.texte, output.duree_totale_s);
  return problems.length === 0 ? ok : fail(`Piste texte : ${problems.join(" ; ")}.`);
}

export function checkSubtitles(output: Output, context: EditContext): ControlResult {
  const cues = output.pistes.sous_titres;
  const problems = spanProblems("sous-titre", cues, output.duree_totale_s);
  if (cues.length !== context.words.length) problems.push(`${cues.length} entrées pour ${context.words.length} mots prononcés`);
  cues.forEach((cue, index) => {
    const next = cues[index + 1];
    if (next && next.debut_s < cue.fin_s - ROUNDING_S) problems.push(`sous-titres n° ${index + 1} et ${index + 2} se chevauchent`);
    if (cue.mots.split(/\s+/u).length > MAX_WORDS_PER_GROUP) problems.push(`groupe de plus de ${MAX_WORDS_PER_GROUP} mots : « ${cue.mots} »`);
  });
  return problems.length === 0 ? ok : fail(`Sous-titres (recalés en code) : ${problems.join(" ; ")}.`);
}

export function checkAudio(output: Output, context: EditContext): ControlResult {
  const voices = output.pistes.audio.filter((clip) => clip.type === "voix");
  const voice = voices.length === 1 ? voices[0] : undefined;
  const allowed = new Set([context.voice.url, ...(context.music ? [context.music.url] : [])]);
  const problems = [
    voice?.src === context.voice.url && voice.debut_s === 0 ? null : "une seule piste voix, avec le fichier fourni, à 0 s",
    ...output.pistes.audio.filter((clip) => !allowed.has(clip.src)).map((clip) => `${clip.type} avec un fichier non fourni (« ${clip.src} »)`),
  ].filter((problem) => problem !== null);
  return problems.length === 0 ? ok : fail(`Piste audio : ${problems.join(" ; ")}.`);
}

export function checkDuration(output: Output, context: EditContext): ControlResult {
  const { duree_totale_s: durationS } = output;
  const { lastWordEndS } = context;
  if (durationS < lastWordEndS - ROUNDING_S) return fail(`La vidéo (${seconds(durationS)} s) coupe la voix : dernier mot à ${seconds(lastWordEndS)} s.`);
  if (durationS > lastWordEndS + MAX_TAIL_S + ROUNDING_S) {
    return fail(`La vidéo (${seconds(durationS)} s) finit plus de ${MAX_TAIL_S} s après le dernier mot (${seconds(lastWordEndS)} s).`);
  }
  return ok;
}

export function checkExport(output: Output): ControlResult {
  const { largeur, hauteur, fps } = output.export;
  return largeur === WIDTH && hauteur === HEIGHT && fps === FPS ? ok : fail(`Export ${largeur}×${hauteur} à ${fps} i/s au lieu de ${WIDTH}×${HEIGHT} à ${FPS} i/s.`);
}

/** Tous les contrôles, dans l'ordre où le modèle les lira. */
export function checkTimeline(output: Output, context: EditContext): ControlResult[] {
  return [
    checkIdea(output, context),
    checkExport(output),
    checkDuration(output, context),
    checkPlansPlaced(output, context),
    checkPlanOrder(output, context),
    checkVideoCoverage(output),
    checkMovement(output),
    checkVideoMedia(output, context),
    checkTextTrack(output),
    checkSubtitles(output, context),
    checkAudio(output, context),
  ];
}
