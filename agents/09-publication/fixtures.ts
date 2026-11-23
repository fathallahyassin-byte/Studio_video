import { IDEA, makeScript, TEST_BIBLE } from "@/agents/04-scenariste/fixtures";
import { makeReport } from "@/agents/08-controle-qualite/fixtures";
import type { Platform } from "@/lib/generated/prisma/client";
import type { Actor } from "@/lib/pipeline/service";
import type { Notification } from "@/lib/providers/notify";
import type { PublishProvider, PublishRequest } from "@/lib/providers/publish";
import type { PublicationPorts, PublicationRow, PublicationVideo, TakenSlot } from "./ports";
import type { PublishingPorts, StoredPublication } from "./publishing";
import type { Output } from "./schema";

// Données d'exemple et faux ports pour les tests de l'agent 9 (aucun appel réel au modèle ni à une plateforme).

export { IDEA, makeReport, makeScript, TEST_BIBLE };

/** Lundi 23 novembre 2026, 10 h (heure locale). */
export const NOW = new Date(2026, 10, 23, 10, 0);

/** Sortie conforme au prompt, créneaux dans le futur par rapport à NOW. */
export function makeOutput(overrides: Partial<Output> = {}): Output {
  return {
    idee_id: "I-07",
    tiktok: {
      legende:
        "Le trombone que tu utilises n'a pas été inventé par qui tu crois. En 1899, un brevet américain décrit déjà sa forme actuelle, bien avant la légende norvégienne. Tu le savais ?",
      hashtags: ["#objets", "#histoiredesobjets", "#trombone", "#brevet1899"],
      texte_couverture: "Le vrai secret du trombone",
      commentaire_epingle: "Tu pensais qu'il était norvégien ?",
      etiquette_ia: true,
      contenu_de_marque: false,
      creneau: "2026-11-24T18:00",
    },
    instagram: {
      legende: "Ton trombone a une histoire plus vieille que tu ne crois. Un brevet de 1899 décrit déjà sa forme.",
      hashtags: ["#histoiredesobjets", "#trombone"],
      texte_couverture: "Qui a inventé le trombone",
      etiquette_ia: true,
      partenariat: false,
      creneau: "2026-11-24T12:30",
    },
    youtube: {
      titre: "Trombone : la vraie histoire de son invention en 1899",
      description: "Le trombone n'a pas été inventé en Norvège. Un brevet américain de 1899 décrit déjà sa forme.",
      hashtags: ["#trombone", "#histoire", "#objets"],
      commentaire_epingle: "Quel objet du quotidien veux-tu voir ensuite ?",
      contient_media_synthetique: false,
      creneau: "2026-11-25T17:00",
    },
    mots_cles_vises: ["trombone", "histoire du trombone", "invention trombone"],
    ...overrides,
  };
}

export function makeVideo(overrides: Partial<PublicationVideo> = {}): PublicationVideo {
  return {
    channelId: "chaine-1",
    stage: "SCHEDULED",
    number: 7,
    title: "Le secret du trombone",
    idea: IDEA,
    script: makeScript(),
    qaReport: makeReport(),
    hasV3Approval: true,
    channelPlatforms: [],
    ...overrides,
  };
}

export type SavedPlan = { texts: Output; rows: PublicationRow[] };

/**
 * Faux ports de l'agent 9. savePlan se comporte comme la base : une ligne par (vidéo, plateforme),
 * mise à jour seulement tant qu'elle est SCHEDULED, et le « trigger » refuse sans V3 approuvée.
 */
export function makePublicationPorts(options: { video?: PublicationVideo | null; keywords?: string; taken?: TakenSlot[]; ready?: readonly Platform[] } = {}) {
  const video = options.video === undefined ? makeVideo() : options.video;
  const publications = new Map<Platform, PublicationRow & { status: "SCHEDULED" | "PUBLISHED" }>();
  const calls = { saves: [] as SavedPlan[], loads: 0 };
  const ports: PublicationPorts = {
    now: () => NOW,
    async loadVideo() {
      calls.loads += 1;
      return video ? { ...video } : null;
    },
    async loadKeywords() {
      return options.keywords ?? "trombone\nhistoire des objets";
    },
    async loadTakenSlots() {
      return options.taken ?? [];
    },
    isProviderReady: (platform) => options.ready?.includes(platform) ?? false,
    async savePlan(_videoId, texts, rows) {
      if (!video?.hasV3Approval) throw new Error("Publication refusée : la vidéo n'a pas de validation V3 approuvée (trigger)");
      calls.saves.push({ texts, rows: [...rows] });
      for (const row of rows) {
        const existing = publications.get(row.platform);
        if (!existing) publications.set(row.platform, { ...row, status: "SCHEDULED" });
        else if (existing.status === "SCHEDULED") publications.set(row.platform, { ...existing, ...row });
      }
    },
  };
  return { ports, video, publications, calls };
}

export function makeStoredPublication(overrides: Partial<StoredPublication> = {}, video: Partial<StoredPublication["video"]> = {}): StoredPublication {
  return {
    id: "pub-tiktok",
    videoId: "video-1",
    platform: "TIKTOK",
    mode: "MANUAL",
    status: "SCHEDULED",
    scheduledFor: new Date(NOW.getTime() - 60_000),
    aiLabel: true,
    brandedContent: false,
    ...overrides,
    video: {
      stage: "SCHEDULED",
      number: 7,
      title: "Le secret du trombone",
      hasV3Approval: true,
      texts: makeOutput(),
      qaReport: makeReport(),
      renderUrl: "https://media.example.org/rendus/video-1.mp4",
      ...video,
    },
  };
}

export function makeFakeProvider(platform: Platform, options: { ready?: boolean; fail?: boolean } = {}): PublishProvider & { requests: PublishRequest[] } {
  const requests: PublishRequest[] = [];
  return {
    platform,
    ready: options.ready ?? true,
    requests,
    async publish(request) {
      requests.push(request);
      if (options.fail) throw new Error("quota dépassé");
      return { externalId: `ext-${requests.length}` };
    },
  };
}

/** Faux ports de publication : état en mémoire, transitions comme en base. */
export function makePublishingPorts(publication: StoredPublication | null, provider: PublishProvider | null = null) {
  const state = publication ? { ...publication, video: { ...publication.video } } : null;
  const calls = { notifications: [] as Notification[], completed: [] as Actor[], externalIds: [] as (string | null)[], claims: 0 };
  const ports: PublishingPorts = {
    now: () => NOW,
    async loadPublication() {
      return state ? { ...state, video: { ...state.video } } : null;
    },
    providerFor: () => provider,
    async claim() {
      calls.claims += 1;
      if (state?.status !== "SCHEDULED") return false;
      state.status = "PUBLISHING";
      return true;
    },
    async markPublished(_id, externalId) {
      if (!state || state.status === "PUBLISHED") return false;
      if (!state.video.hasV3Approval) throw new Error("trigger : pas de V3");
      state.status = "PUBLISHED";
      calls.externalIds.push(externalId);
      return true;
    },
    async markFailed() {
      if (state?.status === "PUBLISHING") state.status = "FAILED";
    },
    async completeVideo(_videoId, actor) {
      if (state?.video.stage !== "SCHEDULED") return;
      state.video.stage = "PUBLISHED";
      calls.completed.push(actor);
    },
    async notify(notification) {
      calls.notifications.push(notification);
    },
  };
  return { ports, state, calls };
}
