import { getDb } from "@/lib/db";
import { getPipelineDeps } from "@/lib/pipeline/deps";
import { completeStage, TransitionError } from "@/lib/pipeline/service";
import type { PublishingPorts, StoredPublication } from "./publishing";

// Ports réels de la publication. Aucune API de publication n'est branchée : providerFor renvoie null (NEEDS.md).

export function createPrismaPublishingPorts(): PublishingPorts {
  const db = () => getDb();
  return {
    now: () => new Date(),
    loadPublication,
    providerFor: () => null,
    async claim(publicationId) {
      const claimed = await db().publication.updateMany({ where: { id: publicationId, status: "SCHEDULED" }, data: { status: "PUBLISHING" } });
      return claimed.count === 1;
    },
    async markPublished(publicationId, externalId, at) {
      const updated = await db().publication.updateMany({
        where: { id: publicationId, status: { in: ["SCHEDULED", "PUBLISHING", "FAILED"] } },
        data: { status: "PUBLISHED", publishedAt: at, ...(externalId === null ? {} : { externalId }) },
      });
      return updated.count === 1;
    },
    async markFailed(publicationId) {
      await db().publication.updateMany({ where: { id: publicationId, status: "PUBLISHING" }, data: { status: "FAILED" } });
    },
    async completeVideo(videoId, actor) {
      const video = await db().video.findUnique({ where: { id: videoId }, select: { stage: true } });
      if (video?.stage !== "SCHEDULED") return;
      try {
        await completeStage(getPipelineDeps(), { videoId, event: "PUBLISHED", actor });
      } catch (error) {
        // Une autre publication de la vidéo l'a fait passer en PUBLISHED entre-temps.
        if (error instanceof TransitionError && (await db().video.findUnique({ where: { id: videoId }, select: { stage: true } }))?.stage === "PUBLISHED") return;
        throw error;
      }
    },
    async notify(notification) {
      await getPipelineDeps().notifier.notify(notification);
    },
  };
}

async function loadPublication(publicationId: string): Promise<StoredPublication | null> {
  const publication = await getDb().publication.findUnique({
    where: { id: publicationId },
    select: {
      id: true,
      videoId: true,
      platform: true,
      mode: true,
      status: true,
      scheduledFor: true,
      aiLabel: true,
      brandedContent: true,
      video: {
        select: {
          stage: true,
          number: true,
          title: true,
          publishJson: true,
          qaJson: true,
          _count: { select: { validations: { where: { gate: "V3", decision: "APPROVED" } } } },
          assets: { where: { type: "RENDER" }, orderBy: { createdAt: "desc" }, take: 1, select: { url: true } },
        },
      },
    },
  });
  if (!publication) return null;
  const { video, ...rest } = publication;
  return {
    ...rest,
    video: {
      stage: video.stage,
      number: video.number,
      title: video.title,
      hasV3Approval: video._count.validations > 0,
      texts: video.publishJson,
      qaReport: video.qaJson,
      renderUrl: video.assets[0]?.url ?? null,
    },
  };
}
