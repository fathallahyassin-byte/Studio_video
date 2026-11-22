import { Panel as Card } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getDb } from "@/lib/db";
import { configuredVisualTools } from "../ports";
import { loadStoryboardOverview, readPanelBudget } from "./loadStoryboards";
import { StoryboardBrowser, type RegenerationAvailability } from "./StoryboardBrowser";
import { regenerationAvailability, summaryLine } from "./summary";

// Panneau de /agents/05-directeur-artistique : storyboards récents, vignettes 9:16 par plan, budget de vidéo IA.

export async function Panel() {
  const channel = await requireCurrentChannel();
  const tools = configuredVisualTools();
  const { storyboards, inProgress, unreadable, budgetS } = await loadStoryboardOverview(getDb(), channel.id, readPanelBudget());
  const regeneration: RegenerationAvailability = regenerationAvailability({ image: tools.image?.name ?? null, video: tools.video?.name ?? null });

  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-[750] text-ink">Storyboards</h2>
        <p className="mt-1 text-muted">{summaryLine({ inProgress, unreadable, budgetS })}</p>
        {regeneration.note ? <p className="mt-1 text-[13px] text-muted">{regeneration.note}</p> : null}
      </div>
      {storyboards.length === 0 ? (
        <p className="text-muted">Aucun storyboard pour l&apos;instant : il arrive dès qu&apos;un script est validé en V2.</p>
      ) : (
        <StoryboardBrowser storyboards={storyboards} regeneration={regeneration} />
      )}
    </Card>
  );
}
