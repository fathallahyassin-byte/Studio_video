import { Suspense } from "react";
import { Panel as Card } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getDb } from "@/lib/db";
import { KeywordsForm } from "./Forms";
import { loadKeywords, loadPublicationVideos } from "./loadOverview";
import { buildOverview } from "./overview";
import { PublicationBrowser } from "./PublicationBrowser";
import { WeekCalendar } from "./WeekCalendar";

// Panneau de /agents/09-publication : calendrier de la semaine par plateforme, textes par vidéo, mode manuel.

export async function Panel() {
  const channel = await requireCurrentChannel();
  const db = getDb();
  const now = new Date();
  const [videos, keywords] = await Promise.all([loadPublicationVideos(db, channel.id, now), loadKeywords(db)]);
  const overview = buildOverview(videos, now);

  return (
    <>
      <Card className="flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-[750] text-ink">Calendrier de publication</h2>
          <p className="mt-1 text-muted">
            Aucune API de publication n&apos;est branchée : chaque vidéo se publie à la main à l&apos;heure prévue (export du MP4 et des textes, puis « Marquer comme
            publié »). Les étiquettes IA viennent du rapport qualité et ne se modifient pas ici.
          </p>
        </div>
        {overview.weeks.map((week) => (
          <WeekCalendar key={week.title} week={week} />
        ))}
      </Card>

      <Card className="flex flex-col gap-5">
        <h2 className="text-lg font-[750] text-ink">Vidéos à publier</h2>
        {overview.videos.length === 0 ? (
          <p className="text-muted">Aucune vidéo programmée : l&apos;agent démarre après le GO final (V3 approuvée).</p>
        ) : (
          <Suspense fallback={null}>
            <PublicationBrowser videos={overview.videos} />
          </Suspense>
        )}
      </Card>

      <Card>
        <KeywordsForm keywords={keywords.text} />
      </Card>
    </>
  );
}
