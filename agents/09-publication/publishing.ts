import { readPublicationLabels } from "@/agents/08-controle-qualite/labels";
import type { Platform, PublicationStatus, PublishMode, Stage } from "@/lib/generated/prisma/client";
import type { Actor } from "@/lib/pipeline/service";
import type { Notification } from "@/lib/providers/notify";
import type { PublishProvider, PublishRequest } from "@/lib/providers/publish";
import { formatVideoNumber } from "@/lib/dashboard/format";
import { composeCaption, platformLabel, textsFor } from "./platforms";
import { outputSchema, type Output } from "./schema";

// Publication à l'heure prévue (tâche planifiée, branchée par la session principale : voir NEEDS.md)
// et « Marquer comme publié ». Rien ne part sans V3 approuvée ; les étiquettes viennent du rapport qualité.

export type StoredPublication = {
  id: string;
  videoId: string;
  platform: Platform;
  mode: PublishMode;
  status: PublicationStatus;
  scheduledFor: Date | null;
  aiLabel: boolean;
  brandedContent: boolean;
  video: {
    stage: Stage;
    number: number;
    title: string;
    hasV3Approval: boolean;
    /** Video.publishJson : textes de l'agent 9, éventuellement modifiés par l'humain */
    texts: unknown;
    /** Video.qaJson */
    qaReport: unknown;
    /** URL du dernier Asset RENDER */
    renderUrl: string | null;
  };
};

export type PublishingPorts = {
  now(): Date;
  loadPublication(publicationId: string): Promise<StoredPublication | null>;
  /** fournisseur de la plateforme, ou null tant qu'aucune API n'est branchée */
  providerFor(platform: Platform): PublishProvider | null;
  /** SCHEDULED → PUBLISHING, atomiquement ; false si une autre exécution l'a déjà prise */
  claim(publicationId: string): Promise<boolean>;
  /** → PUBLISHED (depuis SCHEDULED, PUBLISHING ou FAILED) ; false si elle l'était déjà */
  markPublished(publicationId: string, externalId: string | null, at: Date): Promise<boolean>;
  markFailed(publicationId: string): Promise<void>;
  /** SCHEDULED → PUBLISHED pour la vidéo (lib/pipeline), à sa première publication ; sans effet si elle n'est plus SCHEDULED */
  completeVideo(videoId: string, actor: Actor): Promise<void>;
  notify(notification: Notification): Promise<void>;
};

/** Même forme que JobOutcome (jobs/outcome.ts), pour que le worker l'applique tel quel. */
export type PublishOutcome =
  | { kind: "done"; note?: string }
  | { kind: "retry"; delayMs: number; reason: string; alert?: boolean }
  | { kind: "failed"; reason: string };

/** Étapes où une publication peut encore partir : programmée, ou déjà publiée sur une autre plateforme. */
const PUBLISHABLE_STAGES: readonly Stage[] = ["SCHEDULED", "PUBLISHED"];

export const NO_V3 = "Publication refusée : la vidéo n'a pas de validation V3 approuvée.";

export function publicationPath(videoId: string): string {
  return `/agents/09-publication?video=${videoId}`;
}

type Refusal = { reason: string; final: boolean };

/** Ce qui interdit de publier, quel que soit le mode ; null si rien. */
export function publishRefusal(publication: StoredPublication): Refusal | null {
  if (!PUBLISHABLE_STAGES.includes(publication.video.stage)) return { reason: "La vidéo n'est plus programmée (abandonnée ou renvoyée en correction).", final: true };
  if (!publication.video.hasV3Approval) return { reason: NO_V3, final: true };
  if (!readPublicationLabels(publication.video.qaReport)) return { reason: "Rapport qualité absent ou illisible : étiquettes IA inconnues.", final: true };
  if (!outputSchema.safeParse(publication.video.texts).success) return { reason: "Textes de publication absents ou illisibles : relance l'agent 9.", final: true };
  return null;
}

/** Requête pour le fournisseur : étiquettes du rapport qualité, jamais plus basses que celles enregistrées. */
export function buildPublishRequest(publication: StoredPublication, texts: Output, videoUrl: string): PublishRequest {
  const labels = readPublicationLabels(publication.video.qaReport)?.[publication.platform];
  const platformTexts = textsFor(texts, publication.platform);
  return {
    videoUrl,
    caption: platformTexts.body,
    hashtags: platformTexts.hashtags,
    aiLabel: publication.aiLabel || (labels?.aiLabel ?? true),
    brandedContent: publication.brandedContent || (labels?.brandedContent ?? false),
    ...(platformTexts.title === null ? {} : { title: platformTexts.title }),
  };
}

export function manualNotification(publication: StoredPublication, texts: Output): Notification {
  const caption = composeCaption(textsFor(texts, publication.platform));
  return {
    kind: "validation_waiting",
    title: `À publier à la main : ${platformLabel(publication.platform)} · ${formatVideoNumber(publication.video.number)}`,
    message: `${publication.video.title}\n\n${caption.slice(0, 280)}${caption.length > 280 ? "…" : ""}`,
    path: publicationPath(publication.videoId),
  };
}

const SYSTEM: Actor = { kind: "system" };

/**
 * Tâche planifiée d'une Publication. À l'heure prévue : par API si le fournisseur est prêt (mode API),
 * sinon notification « à publier à la main ». Une publication interrompue en cours n'est jamais relancée seule.
 */
export async function runPublication(ports: PublishingPorts, publicationId: string, options: { slot?: Date } = {}): Promise<PublishOutcome> {
  const publication = await ports.loadPublication(publicationId);
  if (!publication) return { kind: "failed", reason: "Publication introuvable." };
  // Créneau modifié depuis la création de la tâche : la tâche du nouveau créneau s'en charge (pas de double notification).
  if (options.slot && publication.scheduledFor?.getTime() !== options.slot.getTime()) return { kind: "done", note: "Créneau modifié : une autre tâche s'en charge." };
  const early = statusOutcome(publication);
  if (early) return early;
  const refusal = publishRefusal(publication);
  if (refusal) return { kind: "failed", reason: refusal.reason };
  const delayMs = (publication.scheduledFor?.getTime() ?? Number.POSITIVE_INFINITY) - ports.now().getTime();
  if (delayMs > 0) return { kind: "retry", delayMs: Number.isFinite(delayMs) ? delayMs : 60 * 60 * 1000, reason: "Pas encore l'heure prévue." };

  const texts = outputSchema.parse(publication.video.texts);
  const provider = publication.mode === "API" ? ports.providerFor(publication.platform) : null;
  if (!provider?.ready) {
    await ports.notify(manualNotification(publication, texts));
    return { kind: "done", note: "Publication manuelle : l'humain est prévenu." };
  }
  return publishWithProvider(ports, publication, texts, provider);
}

function statusOutcome(publication: StoredPublication): PublishOutcome | null {
  switch (publication.status) {
    case "PUBLISHED":
      return { kind: "done", note: "Déjà publiée." };
    case "FAILED":
      return { kind: "done", note: "En échec : à reprendre à la main." };
    case "PUBLISHING":
      return { kind: "failed", reason: "Publication interrompue en cours d'envoi : vérifie sur la plateforme, puis « Marquer comme publié »." };
    case "SCHEDULED":
      return null;
  }
}

async function publishWithProvider(ports: PublishingPorts, publication: StoredPublication, texts: Output, provider: PublishProvider): Promise<PublishOutcome> {
  const videoUrl = publication.video.renderUrl;
  if (!videoUrl) return { kind: "failed", reason: "Aucun MP4 rendu pour cette vidéo." };
  if (!(await ports.claim(publication.id))) return { kind: "done", note: "Déjà prise par une autre exécution." };
  let externalId: string;
  try {
    ({ externalId } = await provider.publish(buildPublishRequest(publication, texts, videoUrl)));
  } catch (error) {
    await ports.markFailed(publication.id);
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "failed", reason: `${platformLabel(publication.platform)} a refusé la publication : ${message}. Vérifie sur la plateforme avant de republier.` };
  }
  await ports.markPublished(publication.id, externalId, ports.now());
  await ports.completeVideo(publication.videoId, SYSTEM);
  return { kind: "done" };
}

export type ManualResult = { ok: boolean; message: string };

/** « Marquer comme publié » : refusé sans V3 approuvée ; la vidéo passe en PUBLISHED à sa première publication. */
export async function markPublishedManually(ports: PublishingPorts, input: { publicationId: string; link: string | null; actor: Actor }): Promise<ManualResult> {
  const publication = await ports.loadPublication(input.publicationId);
  if (!publication) return { ok: false, message: "Publication introuvable." };
  if (publication.status === "PUBLISHED") return { ok: true, message: "Déjà marquée comme publiée." };
  if (!PUBLISHABLE_STAGES.includes(publication.video.stage)) return { ok: false, message: "La vidéo n'est plus programmée : publication impossible." };
  if (!publication.video.hasV3Approval) return { ok: false, message: NO_V3 };
  await ports.markPublished(publication.id, input.link, ports.now());
  await ports.completeVideo(publication.videoId, input.actor);
  return { ok: true, message: `${platformLabel(publication.platform)} : marquée comme publiée.` };
}
