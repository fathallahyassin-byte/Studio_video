import type { ControlResult } from "@/agents/_shared/types";
import type { Platform } from "@/lib/generated/prisma/client";
import { composeCaption, HARD_LIMITS, platformLabel, PLATFORMS, slotOf, textsFor, type PlatformTexts } from "./platforms";
import type { Output } from "./schema";
import { MAX_HORIZON_MS, MIN_GAP_MS, parseSlot } from "./slots";
import { containsKeyword, countWords, firstSentence, fold, isValidHashtag, keywordPosition, normalizeHashtags, splitSentences, utf8Bytes } from "./text";
import type { Labels } from "./variables";

// Recalculs (normalize) et refus (controls) en code. Les refus reprennent le prompt (« À PRODUIRE », « RÈGLES »)
// et les limites des plateformes ; chaque refus est renvoyé au modèle.

export type PublicationContext = {
  /** id de l'idée de la vidéo, recopié dans idee_id */
  ideaId: string;
  /** étiquettes du rapport qualité : imposées, jamais choisies par le modèle */
  labels: Labels;
  now: Date;
};

// ---------------------------------------------------------------------------
// normalize : nettoyage, étiquettes imposées.
// ---------------------------------------------------------------------------

function cleanList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = fold(value);
      if (value === "" || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Les étiquettes de la sortie, recopiées du rapport qualité. */
export function applyLabels(output: Output, labels: Labels): Output {
  return {
    ...output,
    tiktok: { ...output.tiktok, etiquette_ia: labels.TIKTOK.aiLabel, contenu_de_marque: labels.TIKTOK.brandedContent },
    instagram: { ...output.instagram, etiquette_ia: labels.INSTAGRAM.aiLabel, partenariat: labels.INSTAGRAM.brandedContent },
    youtube: { ...output.youtube, contient_media_synthetique: labels.YOUTUBE.aiLabel },
  };
}

export function normalizeOutput(output: Output, ctx: PublicationContext): Output {
  const { tiktok, instagram, youtube } = output;
  const cleaned: Output = {
    idee_id: ctx.ideaId,
    tiktok: {
      ...tiktok,
      legende: tiktok.legende.trim(),
      hashtags: normalizeHashtags(tiktok.hashtags),
      texte_couverture: tiktok.texte_couverture.trim(),
      commentaire_epingle: tiktok.commentaire_epingle.trim(),
    },
    instagram: { ...instagram, legende: instagram.legende.trim(), hashtags: normalizeHashtags(instagram.hashtags), texte_couverture: instagram.texte_couverture.trim() },
    youtube: {
      ...youtube,
      titre: youtube.titre.trim(),
      description: youtube.description.trim(),
      hashtags: normalizeHashtags(youtube.hashtags),
      commentaire_epingle: youtube.commentaire_epingle.trim(),
    },
    mots_cles_vises: cleanList(output.mots_cles_vises),
  };
  return applyLabels(cleaned, ctx.labels);
}

// ---------------------------------------------------------------------------
// Limites des plateformes : aussi appliquées aux textes modifiés par l'humain.
// ---------------------------------------------------------------------------

const ANGLE_BRACKETS = /[<>]/;

function hashtagIssues(platform: Platform, hashtags: readonly string[]): string[] {
  const invalid = hashtags.filter((tag) => !isValidHashtag(tag));
  const issues = invalid.length > 0 ? [`${platformLabel(platform)} : hashtags invalides (lettres, chiffres et _ seulement, sans espace) : ${invalid.join(", ")}`] : [];
  if (platform === "INSTAGRAM" && hashtags.length > HARD_LIMITS.instagramHashtags) {
    issues.push(`Instagram Reels : ${hashtags.length} hashtags, ${HARD_LIMITS.instagramHashtags} au plus.`);
  }
  return issues;
}

function lengthIssues(platform: Platform, texts: PlatformTexts): string[] {
  const caption = composeCaption(texts);
  switch (platform) {
    case "TIKTOK":
      return caption.length > HARD_LIMITS.tiktokCaption ? [`TikTok : légende et hashtags font ${caption.length} caractères, ${HARD_LIMITS.tiktokCaption} au plus.`] : [];
    case "INSTAGRAM":
      return caption.length > HARD_LIMITS.instagramCaption ? [`Instagram Reels : légende et hashtags font ${caption.length} caractères, ${HARD_LIMITS.instagramCaption} au plus.`] : [];
    case "YOUTUBE":
      return youtubeIssues(texts.title ?? "", caption);
  }
}

function youtubeIssues(title: string, description: string): string[] {
  const issues: string[] = [];
  if (title.length > HARD_LIMITS.youtubeTitle) issues.push(`YouTube Shorts : titre de ${title.length} caractères, ${HARD_LIMITS.youtubeTitle} au plus.`);
  if (utf8Bytes(description) > HARD_LIMITS.youtubeDescriptionBytes) issues.push(`YouTube Shorts : description trop longue (${HARD_LIMITS.youtubeDescriptionBytes} octets au plus).`);
  if (ANGLE_BRACKETS.test(title) || ANGLE_BRACKETS.test(description)) issues.push("YouTube Shorts : « < » et « > » sont refusés dans le titre et la description.");
  return issues;
}

function emptyIssues(platform: Platform, texts: PlatformTexts): string[] {
  const issues = texts.body.trim() === "" ? [`${platformLabel(platform)} : le texte est vide.`] : [];
  if (texts.title !== null && texts.title.trim() === "") issues.push(`${platformLabel(platform)} : le titre est vide.`);
  return issues;
}

/** Ce que la plateforme refuserait : texte vide, longueur, hashtags. */
export function hardLimitIssues(platform: Platform, texts: PlatformTexts): string[] {
  return [...emptyIssues(platform, texts), ...lengthIssues(platform, texts), ...hashtagIssues(platform, texts.hashtags)];
}

// ---------------------------------------------------------------------------
// controls : règles du prompt.
// ---------------------------------------------------------------------------

const ok: ControlResult = { ok: true };
const fail = (reason: string): ControlResult => ({ ok: false, reason });
const check = (condition: boolean, reason: string): ControlResult => (condition ? ok : fail(reason));

function between(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

export function mainKeyword(output: Output): string | null {
  return output.mots_cles_vises[0] ?? null;
}

function checkTiktok(output: Output): ControlResult[] {
  const { tiktok } = output;
  const keyword = mainKeyword(output);
  return [
    check(between(tiktok.legende.length, 150, 300), `tiktok.legende : 150 à 300 caractères (hors hashtags), elle en fait ${tiktok.legende.length}.`),
    check(
      keyword === null || containsKeyword(firstSentence(tiktok.legende), keyword),
      `tiktok.legende : la 1re phrase doit contenir le mot-clé principal « ${keyword ?? ""} » (premier de mots_cles_vises).`,
    ),
    check(between(tiktok.hashtags.length, 3, 5), `tiktok.hashtags : 3 à 5 hashtags différents, il y en a ${tiktok.hashtags.length}.`),
    check(between(countWords(tiktok.texte_couverture), 3, 5), "tiktok.texte_couverture : 3 à 5 mots."),
    check(tiktok.commentaire_epingle.includes("?"), "tiktok.commentaire_epingle : une question qui appelle des réponses (avec « ? »)."),
  ];
}

function checkInstagram(output: Output): ControlResult[] {
  const { instagram } = output;
  const sentences = splitSentences(instagram.legende).length;
  return [
    check(between(sentences, 1, 3), `instagram.legende : 1 à 3 phrases, elle en compte ${sentences}.`),
    check(between(instagram.hashtags.length, 1, HARD_LIMITS.instagramHashtags), `instagram.hashtags : quelques hashtags de niche (1 à ${HARD_LIMITS.instagramHashtags}).`),
    check(between(countWords(instagram.texte_couverture), 3, 5), "instagram.texte_couverture : 3 à 5 mots, lisibles dans la grille du profil."),
  ];
}

function checkYoutube(output: Output): ControlResult[] {
  const { youtube } = output;
  const keyword = mainKeyword(output);
  const position = keyword === null ? 0 : keywordPosition(youtube.titre, keyword);
  const sentences = splitSentences(youtube.description).length;
  return [
    check(between(youtube.titre.length, 40, 70), `youtube.titre : 40 à 70 caractères, il en fait ${youtube.titre.length}.`),
    check(position !== null && position <= 2, `youtube.titre : le mot-clé principal « ${keyword ?? ""} » doit être au début (dans les trois premiers mots).`),
    check(between(sentences, 2, 3), `youtube.description : 2 phrases (3 au plus), elle en compte ${sentences}.`),
    check(youtube.hashtags.length === 3, `youtube.hashtags : exactement 3 hashtags, il y en a ${youtube.hashtags.length}.`),
    check(youtube.commentaire_epingle !== "", "youtube.commentaire_epingle : un commentaire épinglé est attendu."),
  ];
}

function checkHardLimits(output: Output): ControlResult[] {
  return PLATFORMS.flatMap(({ platform }) => hardLimitIssues(platform, textsFor(output, platform)).map(fail));
}

/** Les hashtags ont leur propre champ : la légende n'en contient pas (sinon ils seraient en double). */
function checkNoInlineHashtags(output: Output): ControlResult[] {
  return PLATFORMS.map(({ platform }) => {
    const body = textsFor(output, platform).body;
    return check(!/(^|\s)#[\p{L}\p{N}_]/u.test(body), `${platformLabel(platform)} : pas de hashtag dans le texte, ils vont dans « hashtags ».`);
  });
}

/** « Pas le même texte copié sur les 3 plateformes » : légendes et description différentes. */
export function checkDistinctTexts(output: Output): ControlResult[] {
  const bodies = PLATFORMS.map(({ platform }) => ({ platform, folded: fold(textsFor(output, platform).body) }));
  const results: ControlResult[] = [];
  bodies.forEach((first, index) => {
    for (const second of bodies.slice(index + 1)) {
      results.push(
        check(
          first.folded !== second.folded,
          `${platformLabel(first.platform)} et ${platformLabel(second.platform)} ont le même texte : adapte le ton et les mots-clés à chaque plateforme.`,
        ),
      );
    }
  });
  return results;
}

const PLATFORM_NAMES: Record<Platform, readonly string[]> = {
  TIKTOK: ["tiktok"],
  INSTAGRAM: ["instagram"],
  YOUTUBE: ["youtube"],
};

function allTexts(output: Output, platform: Platform): string {
  const texts = textsFor(output, platform);
  const extra =
    platform === "TIKTOK"
      ? [output.tiktok.texte_couverture, output.tiktok.commentaire_epingle]
      : platform === "INSTAGRAM"
        ? [output.instagram.texte_couverture]
        : [output.youtube.commentaire_epingle];
  return [texts.title ?? "", texts.body, texts.hashtags.join(" "), ...extra].join(" ");
}

/** Aucune trace d'une autre plateforme (nom, renvoi), comme on ne laisse jamais son filigrane. */
export function checkNoOtherPlatform(output: Output): ControlResult[] {
  return PLATFORMS.flatMap(({ platform }) => {
    const words = new Set(fold(allTexts(output, platform)).split(" "));
    const named = PLATFORMS.filter((other) => other.platform !== platform && PLATFORM_NAMES[other.platform].some((name) => words.has(name)));
    return named.map((other) => fail(`${platformLabel(platform)} : les textes citent ${platformLabel(other.platform)} ; aucune autre plateforme ne doit apparaître.`));
  });
}

function checkKeywords(output: Output): ControlResult[] {
  return [check(between(output.mots_cles_vises.length, 1, 10), "mots_cles_vises : 1 à 10 mots-clés, le principal en premier.")];
}

/** Créneaux : vraie date, dans le futur, à 14 jours au plus, décalés d'au moins une heure entre plateformes. */
export function checkSlots(output: Output, now: Date): ControlResult[] {
  const results: ControlResult[] = [];
  const dates: { platform: Platform; date: Date }[] = [];
  for (const { platform, key } of PLATFORMS) {
    const value = slotOf(output, platform);
    const date = parseSlot(value);
    if (!date) {
      results.push(fail(`${key}.creneau : « ${value} » n'est pas une date valide.`));
      continue;
    }
    results.push(check(date.getTime() > now.getTime(), `${key}.creneau : ${value} est déjà passé.`));
    results.push(check(date.getTime() - now.getTime() <= MAX_HORIZON_MS, `${key}.creneau : ${value} est à plus de 14 jours.`));
    dates.push({ platform, date });
  }
  return [...results, ...checkGaps(dates)];
}

function checkGaps(dates: readonly { platform: Platform; date: Date }[]): ControlResult[] {
  const results: ControlResult[] = [];
  dates.forEach((first, index) => {
    for (const second of dates.slice(index + 1)) {
      const gap = Math.abs(first.date.getTime() - second.date.getTime());
      results.push(
        check(gap >= MIN_GAP_MS, `${platformLabel(first.platform)} et ${platformLabel(second.platform)} : créneaux à décaler d'au moins une heure (quelques heures conseillées).`),
      );
    }
  });
  return results;
}

/** Garde-fou : après normalize, les étiquettes sont celles du rapport qualité. */
export function checkLabels(output: Output, labels: Labels): ControlResult[] {
  const forced = applyLabels(output, labels);
  return [check(JSON.stringify(forced) === JSON.stringify(output), "Étiquettes IA et contenu de marque : recopie exactement celles du rapport qualité.")];
}

export function checkOutput(output: Output, ctx: PublicationContext): ControlResult[] {
  return [
    ...checkLabels(output, ctx.labels),
    ...checkHardLimits(output),
    ...checkNoInlineHashtags(output),
    ...checkTiktok(output),
    ...checkInstagram(output),
    ...checkYoutube(output),
    ...checkDistinctTexts(output),
    ...checkNoOtherPlatform(output),
    ...checkKeywords(output),
    ...checkSlots(output, ctx.now),
  ];
}
