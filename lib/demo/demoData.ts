import type { Stage } from "@/lib/generated/prisma/client";
import type { AnalystReportContent, Idea, QaReport, Script } from "@/lib/dashboard/payloads";

// Données de démonstration, reprises de la maquette (niche « objets du quotidien »).
// Utilisées par `npm run db:seed:demo` pour voir les écrans remplis. Jamais en production.

export const demoBibleValues: Record<string, string> = {
  NOM: "Objets du quotidien",
  NICHE: "L'histoire cachée des objets du quotidien",
  PROMESSE: "Un objet banal, une histoire que personne ne connaît",
  PERSONA: "Curieux de 18 à 35 ans qui aime comprendre le monde qui l'entoure",
  PILIER_1: "Objets de la cuisine",
  PILIER_2: "Objets du bureau",
  PILIER_3: "Objets de la salle de bain",
  FORMAT_1: "Une question, trois révélations",
  FORMAT_2: "L'inventeur oublié",
  FORMAT_3: "Avant / après",
  TON: "Complice, précis, jamais condescendant",
  CE_QUE_LA_CHAINE_APPORTE_DE_PLUS: "La source d'origine de chaque histoire, montrée à l'écran",
  MOTEUR_TTS: "[MOTEUR TTS]",
  ID_VOIX: "[ID DE VOIX]",
  SUFFIXE_STYLE: "warm paper collage, soft studio light, vertical 9:16",
  COULEUR_1: "#F6F7F4",
  COULEUR_2: "#000000",
  ACCENT: "#FFD60A",
  POLICE: "Archivo",
  SIGNATURE: "[SIGNATURE SONORE]",
  CTA: "Abonne-toi pour la suite",
  CRITERE: "[CRITÈRE DE VALIDATION]",
  SOURCE_1: "[SOURCE DE REVENUS 1]",
  SOURCE_2: "[SOURCE DE REVENUS 2]",
};

export type DemoVideo = {
  key: string;
  title: string;
  stage: Stage;
  blockedAt?: Stage;
  blockedReason?: string;
  /** il y a combien de minutes la vidéo a bougé */
  minutesAgo: number;
  idea: Idea;
  script?: Script;
  qa?: QaReport;
  publication?: "scheduled" | "published";
};

function idea(id: string, angle: string, revelation: string, score: number, options: { hypothese?: boolean; pilier?: string } = {}): Idea {
  const base = Math.round(score);
  return {
    id,
    pilier: options.pilier ?? "Objets du bureau",
    format: "Une question, trois révélations",
    angle,
    accroche: `${angle} ?`,
    revelation,
    pourquoi_maintenant: "Question fréquente dans les commentaires de la semaine",
    notes: { accroche: base, interet: base, originalite: base, faisabilite_visuelle: base, verifiabilite: base },
    score,
    hypothese: options.hypothese ?? false,
  };
}

const pencilScript: Script = {
  idee_id: "I-027",
  titre_interne: "Pourquoi les crayons sont jaunes",
  accroches: [
    { type: "affirmation", voix: "Ton crayon est jaune pour une raison qui n'a rien à voir avec l'école.", texte_ecran: "Rien à voir avec l'école" },
    { type: "question", voix: "Pourquoi presque tous les crayons sont-ils jaunes ?", texte_ecran: "Pourquoi jaune ?" },
    { type: "situation", voix: "Tu tailles ton crayon. Et si sa couleur était une publicité vieille de 130 ans ?", texte_ecran: "Une pub de 130 ans" },
  ],
  beats: [
    { n: 1, role: "accroche", debut_s: 0, fin_s: 3, voix: "Ton crayon est jaune pour une raison qui n'a rien à voir avec l'école.", texte_ecran: "Rien à voir avec l'école", faits: [], intention_visuelle: "Gros plan sur une mine qui se casse" },
    { n: 2, role: "contexte", debut_s: 3, fin_s: 10, voix: "En 1890, le meilleur graphite du monde vient de Chine.", texte_ecran: "1890 : le graphite chinois", faits: ["F1"], intention_visuelle: "Carte ancienne, route du graphite" },
    { n: 3, role: "revelation", debut_s: 10, fin_s: 40, voix: "Les fabricants peignent leurs crayons en jaune, la couleur impériale, pour le faire savoir.", texte_ecran: "Le jaune impérial", faits: ["F1", "F2"], intention_visuelle: "Atelier de peinture, crayons alignés" },
    { n: 4, role: "chute", debut_s: 40, fin_s: 65, voix: "Aujourd'hui, le graphite ne vient plus de là… mais la couleur est restée.", texte_ecran: "La couleur est restée", faits: ["F3"], intention_visuelle: "Rayon de supermarché rempli de crayons jaunes" },
    { n: 5, role: "boucle", debut_s: 65, fin_s: 70, voix: "Alors, toujours sûr que c'est pour l'école ?", texte_ecran: "Toujours sûr ?", faits: [], intention_visuelle: "Retour sur la mine du début" },
  ],
  nb_mots: 182,
  duree_estimee_s: 70,
  cta: null,
  verifications: { accroche_sans_son: true, faits_tous_sources: true, duree_ok: true },
};

const barcodeScript: Script = {
  idee_id: "I-028",
  titre_interne: "L'origine du code-barres",
  accroches: [
    { type: "affirmation", voix: "Le code-barres est né d'un dessin dans le sable.", texte_ecran: "Né dans le sable" },
    { type: "question", voix: "Qui a dessiné le premier code-barres, et avec quoi ?", texte_ecran: "Dessiné avec quoi ?" },
    { type: "situation", voix: "Tu passes en caisse. Bip. Ce bip a commencé sur une plage.", texte_ecran: "Bip… sur une plage" },
  ],
  beats: [
    { n: 1, role: "accroche", debut_s: 0, fin_s: 3, voix: "Le code-barres est né d'un dessin dans le sable.", texte_ecran: "Né dans le sable", faits: [], intention_visuelle: "Doigts qui tracent des traits dans le sable" },
    { n: 2, role: "contexte", debut_s: 3, fin_s: 9, voix: "Chaque jour, tu passes des dizaines de produits en caisse sans y penser.", texte_ecran: "Des dizaines par jour", faits: [], intention_visuelle: "Tapis de caisse en accéléré" },
    { n: 3, role: "revelation", debut_s: 9, fin_s: 35, voix: "Un étudiant cherche comment lire un prix d'un coup d'œil. Sur une plage, il trace des traits avec ses doigts.", texte_ecran: "Des traits avec les doigts", faits: ["F1"], intention_visuelle: "Plage, fin de journée" },
    { n: 4, role: "chute", debut_s: 35, fin_s: 60, voix: "Il étire les points et les traits du morse vers le bas. Le code-barres était là.", texte_ecran: "Le morse, étiré", faits: ["F1", "F2"], intention_visuelle: "Morse qui se transforme en barres" },
    { n: 5, role: "boucle", debut_s: 60, fin_s: 66, voix: "La prochaine fois en caisse, pense à la plage.", texte_ecran: "Pense à la plage", faits: [], intention_visuelle: "Bip de caisse, vague en fondu" },
  ],
  nb_mots: 172,
  duree_estimee_s: 66,
  cta: "Abonne-toi pour la suite",
  verifications: { accroche_sans_son: true, faits_tous_sources: true, duree_ok: true },
};

const paperclipQa: QaReport = {
  idee_id: "I-023",
  decision: "GO_AVEC_CORRECTIONS",
  controles: [
    { id: "A1", statut: "ok", preuve: "Les 4 affirmations correspondent aux faits F1 à F4, tous « eleve ».", correction: null, agent_responsable: null },
    { id: "B1", statut: "ok", preuve: "Angle du brevet oublié absent des 10 premiers résultats.", correction: null, agent_responsable: null },
    { id: "C1", statut: "ok", preuve: "Musique sous licence commerciale, enregistrée sur l'Asset.", correction: null, agent_responsable: null },
    { id: "D1", statut: "ok", preuve: "Voix off IA : étiquette IA à activer sur TikTok, Instagram et YouTube.", correction: null, agent_responsable: null },
    { id: "E2", statut: "ok", preuve: "Sous-titres synchronisés, dans la zone sûre.", correction: null, agent_responsable: null },
    { id: "E3", statut: "ok", preuve: "Mix mesuré à −14,2 LUFS.", correction: null, agent_responsable: null },
    { id: "E4", statut: "ko", preuve: "La dernière phrase ne renvoie pas à l'accroche.", correction: "Reprendre le mot « trombone » dans la dernière phrase.", agent_responsable: "04-scenariste" },
  ],
  etiquettes: { tiktok_contenu_ia: true, instagram_contenu_ia: true, youtube_utilisation_ia: true, contenu_de_marque: false },
  mentions_a_incruster: [],
  resume_pour_humain: "Vidéo conforme. Une correction mineure sur la boucle finale. Étiquettes IA à activer sur les trois plateformes (voix off IA).",
};

export function buildDemoVideos(): DemoVideo[] {
  return [
    { key: "capsules", title: "Pourquoi les capsules de bière ont 21 dents", stage: "AWAITING_V1", minutesAgo: 120, idea: idea("I-031", "Pourquoi les capsules de bière ont 21 dents", "Le nombre de dents est un compromis entre étanchéité et ouverture", 4.6, { pilier: "Objets de la cuisine" }) },
    { key: "pince", title: "Qui a inventé la pince à linge", stage: "AWAITING_V1", minutesAgo: 120, idea: idea("I-032", "Qui a inventé la pince à linge", "Des centaines de brevets pour un seul objet", 4.3, { pilier: "Objets de la salle de bain" }) },
    { key: "postit", title: "L'histoire du premier post-it", stage: "AWAITING_V1", minutesAgo: 120, idea: idea("I-033", "L'histoire du premier post-it", "Une colle ratée devenue un succès", 3.7, { hypothese: true }) },
    {
      key: "boutons",
      title: "Pourquoi les boutons de chemise sont à droite",
      stage: "NEEDS_FIX",
      blockedAt: "RESEARCH",
      blockedReason: "Recherchiste & fact-checker : angle à changer, aucune source primaire sur l'origine du côté des boutons.",
      minutesAgo: 300,
      idea: idea("I-026", "Pourquoi les boutons de chemise sont à droite", "Une histoire de domestiques", 3.9, { pilier: "Objets de la salle de bain" }),
    },
    { key: "stylo", title: "Le vrai rôle du petit trou du stylo", stage: "RESEARCH", minutesAgo: 15, idea: idea("I-029", "Le vrai rôle du petit trou du stylo", "Une question de pression, et de sécurité", 4.2) },
    { key: "crayons", title: "Pourquoi les crayons sont jaunes", stage: "AWAITING_V2", minutesAgo: 40, idea: idea("I-027", "Pourquoi les crayons à papier sont jaunes", "La couleur signalait l'origine du graphite", 4.5), script: pencilScript },
    { key: "codebarres", title: "L'origine du code-barres", stage: "AWAITING_V2", minutesAgo: 25, idea: idea("I-028", "L'origine du code-barres", "Le premier dessin a été tracé dans le sable", 4.4), script: barcodeScript },
    { key: "velcro", title: "Le Velcro et la promenade en forêt", stage: "VISUALS_AND_AUDIO", minutesAgo: 12, idea: idea("I-024", "Le Velcro et la promenade en forêt", "Une invention copiée sur une plante", 4.1) },
    { key: "clavier", title: "Pourquoi le clavier n'est pas alphabétique", stage: "EDIT", minutesAgo: 8, idea: idea("I-025", "Pourquoi le clavier n'est pas alphabétique", "La disposition vient des machines à écrire", 4.0) },
    { key: "trombone", title: "Le secret du trombone", stage: "AWAITING_V3", minutesAgo: 10, idea: idea("I-023", "Le secret du trombone", "Le modèle que tout le monde utilise n'est pas celui qu'on croit", 4.3), qa: paperclipQa },
    { key: "savon", title: "Pourquoi le savon mousse", stage: "SCHEDULED", minutesAgo: 600, idea: idea("I-022", "Pourquoi le savon mousse", "La mousse ne lave presque rien", 4.0, { pilier: "Objets de la salle de bain" }), publication: "scheduled" },
    { key: "conserve", title: "La boîte de conserve avant l'ouvre-boîte", stage: "PUBLISHED", minutesAgo: 4 * 24 * 60, idea: idea("I-021", "La boîte de conserve avant l'ouvre-boîte", "On les a ouvertes au marteau pendant des décennies", 4.4, { pilier: "Objets de la cuisine" }), publication: "published" },
  ];
}

/** Statistiques de démonstration (à remplacer par l'import des plateformes, étape 8). */
export const demoStats = [
  { platform: "TIKTOK", views: 18_400, completionRate: 0.41, shares: 312, saves: 540, followersGained: 96, avgWatchTimeS: 38 },
  { platform: "INSTAGRAM", views: 7_900, completionRate: 0.36, shares: 140, saves: 210, followersGained: 31, avgWatchTimeS: 33 },
  { platform: "YOUTUBE", views: 5_200, completionRate: 0.52, shares: 48, saves: 0, followersGained: 22, avgWatchTimeS: 44 },
] as const;

export function buildDemoReport(publishedVideoId: string): AnalystReportContent {
  return {
    periode: "2026-W46",
    resume: "Semaine de lancement : une vidéo publiée sur trois plateformes. Les données sont encore trop maigres pour conclure.",
    top: [{ video_id: publishedVideoId, pourquoi: "Accroche en question et révélation dès 10 s" }],
    flop: [],
    enseignements: [
      { observation: "Les accroches en question retiennent mieux que les affirmations : on les garde.", nb_videos: 1, confiance: "faible", decision: "Garder les accroches en question" },
      { observation: "Les vidéos de plus de 80 secondes décrochent vers la fin : on teste 70 secondes.", nb_videos: 1, confiance: "faible", decision: "Tester des scripts de 70 secondes" },
    ],
    experiences: [{ hypothese: "Une vidéo de 70 s garde plus de spectateurs jusqu'à la fin", variable: "durée", critere_reussite: "Vue complète +5 points sur 4 vidéos" }],
    maj_bible: [],
    maj_backlog: { prioriser: ["Pourquoi les capsules de bière ont 21 dents"], abandonner: [], series: [] },
    verdict_niche: "continuer",
    justification: "Trop tôt pour juger : critère de la niche à évaluer après 10 vidéos.",
  };
}
