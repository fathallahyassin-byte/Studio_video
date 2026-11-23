import { AgentPreconditionError } from "@/lib/agents/errors";
import type { Platform } from "@/lib/generated/prisma/client";
import { ALL_PLATFORMS, slotOf } from "./platforms";
import type { PublicationPorts, PublicationRow } from "./ports";
import { applyLabels } from "./rules";
import type { Output } from "./schema";
import { parseSlot } from "./slots";
import { requireLabels, type Labels } from "./variables";

// Après la sortie : textes enregistrés et une Publication SCHEDULED par plateforme de la chaîne (CLAUDE.md §8 :
// jamais sans V3 approuvée, étiquettes du rapport qualité). Mode API seulement si le fournisseur est prêt.

/** Plateformes de la chaîne, dans l'ordre TikTok, Instagram, YouTube ; aucune réglée = les trois. */
export function targetPlatforms(channelPlatforms: readonly Platform[]): Platform[] {
  return channelPlatforms.length === 0 ? [...ALL_PLATFORMS] : ALL_PLATFORMS.filter((platform) => channelPlatforms.includes(platform));
}

export function buildPublicationRows(texts: Output, labels: Labels, platforms: readonly Platform[], isReady: (platform: Platform) => boolean): PublicationRow[] {
  return platforms.map((platform) => {
    const scheduledFor = parseSlot(slotOf(texts, platform));
    if (!scheduledFor) throw new AgentPreconditionError(`Créneau illisible pour ${platform} : « ${slotOf(texts, platform)} ».`);
    return { platform, mode: isReady(platform) ? "API" : "MANUAL", scheduledFor, ...labels[platform] };
  });
}

/**
 * onSuccess de l'agent 9. Idempotent : rejoué après un crash, il réécrit les mêmes lignes (aucun doublon) ;
 * sans effet si la vidéo n'est plus programmée ; une Publication déjà partie n'est jamais modifiée.
 * Refusé sans Validation V3 approuvée (en plus du trigger SQL) et sans rapport qualité lisible.
 */
export async function recordPublicationPlan(ports: PublicationPorts, videoId: string, output: Output): Promise<void> {
  const video = await ports.loadVideo(videoId);
  if (video?.stage !== "SCHEDULED") return;
  if (!video.hasV3Approval) throw new AgentPreconditionError("Publication refusée : la vidéo n'a pas de validation V3 approuvée.");
  const labels = requireLabels(video.qaReport);
  const texts = applyLabels(output, labels);
  const rows = buildPublicationRows(texts, labels, targetPlatforms(video.channelPlatforms), (platform) => ports.isProviderReady(platform));
  await ports.savePlan(videoId, texts, rows);
}
