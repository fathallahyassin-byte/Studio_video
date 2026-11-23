import { describe, expect, it } from "vitest";
import { readPublicationLabels } from "@/agents/08-controle-qualite/labels";
import { applyPlatformEdit, platformEditSchema } from "./edits";
import { makeOutput, makeReport, NOW } from "./fixtures";
import { checkOutput, hardLimitIssues, normalizeOutput, type PublicationContext } from "./rules";
import type { Output } from "./schema";
import { formatSlot, parseSlot } from "./slots";
import { countWords, keywordPosition, normalizeHashtags, parseHashtagInput, splitSentences } from "./text";
import type { Labels } from "./variables";

function labels(): Labels {
  const read = readPublicationLabels(makeReport());
  if (!read) throw new Error("rapport d'exemple illisible");
  return read;
}

const ctx: PublicationContext = { ideaId: "I-07", labels: labels(), now: NOW };

function failures(output: Output): string[] {
  return checkOutput(normalizeOutput(output, ctx), ctx).flatMap((result) => (result.ok ? [] : [result.reason]));
}

const base = makeOutput();
const tiktok = (changes: Partial<Output["tiktok"]>) => makeOutput({ tiktok: { ...base.tiktok, ...changes } });
const instagram = (changes: Partial<Output["instagram"]>) => makeOutput({ instagram: { ...base.instagram, ...changes } });
const youtube = (changes: Partial<Output["youtube"]>) => makeOutput({ youtube: { ...base.youtube, ...changes } });

describe("sortie d'exemple", () => {
  it("passe tous les contrôles", () => {
    expect(failures(base)).toEqual([]);
  });
});

describe("normalize", () => {
  it("impose les étiquettes du rapport qualité et l'id de l'idée, nettoie hashtags et mots-clés", () => {
    const messy = makeOutput({
      idee_id: "autre",
      tiktok: { ...base.tiktok, hashtags: ["objets", "#Objets", " #histoire des objets ", "#trombone"], etiquette_ia: false, contenu_de_marque: true },
      youtube: { ...base.youtube, contient_media_synthetique: true },
      mots_cles_vises: [" trombone ", "Trombone", ""],
    });
    const normalized = normalizeOutput(messy, ctx);
    expect(normalized.idee_id).toBe("I-07");
    expect(normalized.tiktok.hashtags).toEqual(["#objets", "#histoiredesobjets", "#trombone"]);
    expect(normalized.tiktok).toMatchObject({ etiquette_ia: true, contenu_de_marque: false });
    expect(normalized.youtube.contient_media_synthetique).toBe(false);
    expect(normalized.mots_cles_vises).toEqual(["trombone"]);
  });
});

describe("contrôles en code (un refus par règle)", () => {
  const cases: { name: string; output: Output; reason: string }[] = [
    { name: "légende TikTok trop courte", output: tiktok({ legende: "Le trombone a un secret." }), reason: "tiktok.legende : 150 à 300 caractères" },
    { name: "légende TikTok trop longue", output: tiktok({ legende: `Le trombone ${"a ".repeat(160)}fin.` }), reason: "tiktok.legende : 150 à 300 caractères" },
    {
      name: "mot-clé principal absent de la 1re phrase TikTok",
      output: tiktok({ legende: `Cet objet de bureau n'a pas été inventé par qui tu crois. ${base.tiktok.legende}`.slice(0, 290) }),
      reason: "la 1re phrase doit contenir le mot-clé principal",
    },
    { name: "hashtags TikTok en double (moins de 3 après nettoyage)", output: tiktok({ hashtags: ["#trombone", "#Trombone", "trombone"] }), reason: "tiktok.hashtags : 3 à 5" },
    { name: "couverture TikTok trop longue", output: tiktok({ texte_couverture: "Le vrai secret caché du petit trombone" }), reason: "tiktok.texte_couverture : 3 à 5 mots" },
    { name: "commentaire épinglé TikTok sans question", output: tiktok({ commentaire_epingle: "Abonne-toi." }), reason: "tiktok.commentaire_epingle" },
    { name: "légende Instagram de 4 phrases", output: instagram({ legende: "Un. Deux phrases. Trois phrases. Quatre phrases." }), reason: "instagram.legende : 1 à 3 phrases" },
    { name: "Instagram sans hashtag", output: instagram({ hashtags: [] }), reason: "instagram.hashtags" },
    { name: "Instagram : plus de 5 hashtags", output: instagram({ hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"] }), reason: "Instagram Reels : 6 hashtags, 5 au plus" },
    { name: "couverture Instagram de 2 mots", output: instagram({ texte_couverture: "Le trombone" }), reason: "instagram.texte_couverture" },
    { name: "titre YouTube trop court", output: youtube({ titre: "Trombone : son histoire" }), reason: "youtube.titre : 40 à 70 caractères" },
    { name: "mot-clé loin dans le titre YouTube", output: youtube({ titre: "La vraie histoire de cet objet de bureau : le trombone" }), reason: "doit être au début" },
    { name: "description YouTube d'une phrase", output: youtube({ description: "Le trombone vient d'un brevet de 1899." }), reason: "youtube.description : 2 phrases" },
    { name: "YouTube : 2 hashtags", output: youtube({ hashtags: ["#trombone", "#histoire"] }), reason: "youtube.hashtags : exactement 3" },
    { name: "YouTube : chevrons", output: youtube({ titre: "Trombone <vraie> histoire de son invention en 1899" }), reason: "« < » et « > » sont refusés" },
    { name: "commentaire YouTube vide", output: youtube({ commentaire_epingle: " " }), reason: "youtube.commentaire_epingle" },
    { name: "hashtag invalide", output: tiktok({ hashtags: ["#trombone", "#histoire-objets", "#objets"] }), reason: "hashtags invalides" },
    { name: "hashtag dans la légende", output: instagram({ legende: "Ton trombone a une histoire #trombone. Un brevet de 1899 décrit déjà sa forme." }), reason: "pas de hashtag dans le texte" },
    { name: "même texte sur deux plateformes", output: instagram({ legende: base.tiktok.legende }), reason: "ont le même texte" },
    { name: "autre plateforme citée", output: youtube({ commentaire_epingle: "Tu l'as vu sur TikTok ?" }), reason: "les textes citent TikTok" },
    { name: "aucun mot-clé visé", output: makeOutput({ mots_cles_vises: [] }), reason: "mots_cles_vises : 1 à 10" },
    { name: "créneau impossible", output: tiktok({ creneau: "2026-02-30T18:00" }), reason: "n'est pas une date valide" },
    { name: "créneau passé", output: tiktok({ creneau: "2026-11-22T18:00" }), reason: "est déjà passé" },
    { name: "créneau à plus de 14 jours", output: tiktok({ creneau: "2026-12-10T18:00" }), reason: "à plus de 14 jours" },
    { name: "créneaux trop proches", output: instagram({ creneau: "2026-11-24T18:30" }), reason: "au moins une heure" },
  ];

  it.each(cases)("$name", ({ output, reason }) => {
    expect(failures(output).join("\n")).toContain(reason);
  });
});

describe("limites des plateformes (aussi pour l'humain)", () => {
  it("légende TikTok de plus de 2 200 caractères avec les hashtags", () => {
    expect(hardLimitIssues("TIKTOK", { body: "a".repeat(2190), hashtags: ["#trombone"], title: null })).toEqual([expect.stringContaining("2200 au plus")]);
  });

  it("titre YouTube vide ou de plus de 100 caractères", () => {
    expect(hardLimitIssues("YOUTUBE", { body: "Texte.", hashtags: [], title: " " })).toContain("YouTube Shorts : le titre est vide.");
    expect(hardLimitIssues("YOUTUBE", { body: "Texte.", hashtags: [], title: "t".repeat(101) })).toEqual([expect.stringContaining("101 caractères")]);
  });
});

describe("textes modifiés par l'humain", () => {
  const edit = (fields: Record<string, string>) =>
    platformEditSchema.parse({ videoId: "video-1", platform: "TIKTOK", legende: "Nouvelle légende.", hashtags: "trombone #objets", texte_couverture: "Couverture", commentaire_epingle: "?", creneau: "2026-11-24T20:00", ...fields });

  it("enregistre textes, hashtags et créneau ; les règles éditoriales ne s'imposent pas à l'humain", () => {
    const result = applyPlatformEdit(base, edit({}), labels());
    expect(result).toMatchObject({ ok: true, scheduledFor: new Date(2026, 10, 24, 20, 0) });
    if (result.ok) expect(result.texts.tiktok).toMatchObject({ legende: "Nouvelle légende.", hashtags: ["#trombone", "#objets"], creneau: "2026-11-24T20:00" });
  });

  it("les étiquettes IA ne peuvent pas être décochées : un champ envoyé en plus est ignoré, le rapport fait foi", () => {
    const parsed = platformEditSchema.parse({
      videoId: "video-1",
      platform: "TIKTOK",
      legende: "Texte.",
      hashtags: "#a",
      texte_couverture: "c",
      commentaire_epingle: "?",
      creneau: "2026-11-24T20:00",
      etiquette_ia: "false",
    });
    expect(parsed).not.toHaveProperty("etiquette_ia");
    const lowered: Output = { ...base, tiktok: { ...base.tiktok, etiquette_ia: false } };
    const result = applyPlatformEdit(lowered, parsed, labels());
    expect(result.ok && result.texts.tiktok.etiquette_ia).toBe(true);
  });

  it("refuse un créneau invalide ou un texte que la plateforme refuserait", () => {
    expect(applyPlatformEdit(base, edit({ creneau: "demain" }), labels())).toEqual({ ok: false, issues: ["Créneau invalide : choisis une date et une heure."] });
    expect(applyPlatformEdit(base, edit({ legende: "" }), labels())).toMatchObject({ ok: false, issues: ["TikTok : le texte est vide."] });
  });
});

describe("outils de texte et de créneau", () => {
  it("phrases, mots, mots-clés et hashtags", () => {
    expect(splitSentences("Un. Deux ! Trois… quatre ?")).toHaveLength(4);
    expect(splitSentences("Sans ponctuation")).toHaveLength(1);
    expect(countWords("Le vrai — secret")).toBe(3);
    expect(keywordPosition("Moyen-Âge : la bouffe", "moyen age")).toBe(0);
    expect(keywordPosition("La bouffe du Moyen Âge", "moyen âge")).toBe(3);
    expect(normalizeHashtags(["#A", "a", "b c"])).toEqual(["#A", "#bc"]);
    expect(parseHashtagInput("#a, b ; #")).toEqual(["#a", "#b"]);
  });

  it("créneaux lus à l'heure locale, refusés s'ils n'existent pas", () => {
    expect(parseSlot("2026-11-24T18:00")).toEqual(new Date(2026, 10, 24, 18, 0));
    expect(parseSlot("2026-11-24T25:00")).toBeNull();
    expect(parseSlot("2026-11-24 18:00")).toBeNull();
    expect(formatSlot(new Date(2026, 0, 5, 7, 3))).toBe("2026-01-05T07:03");
  });
});
