import { Panel as Card } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getDb } from "@/lib/db";
import { configuredAudioTools } from "../ports";
import { AudioBrowser } from "./AudioBrowser";
import { loadAudioOverview } from "./loadAudioPlans";
import { providerNotes, regenerationAvailability } from "./summary";

// Panneau de /agents/06-voix-son : plans sonores récents, texte TTS modifiable, voix, musique et sa licence.

export async function Panel() {
  const channel = await requireCurrentChannel();
  const tools = configuredAudioTools();
  const names = { tts: tools.tts?.name ?? null, stt: tools.stt?.name ?? null, music: tools.music?.name ?? null };
  const { plans, inProgress, unreadable } = await loadAudioOverview(getDb(), channel.id);

  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-[750] text-ink">Voix et son</h2>
        <p className="mt-1 text-muted">
          {inProgress > 0 ? `${inProgress} plan(s) sonore(s) en préparation. ` : ""}
          {unreadable > 0 ? `${unreadable} plan(s) illisible(s) masqué(s). ` : ""}
          {providerNotes(names).join(" ")}
        </p>
      </div>
      {plans.length === 0 ? (
        <p className="text-muted">Aucun plan sonore pour l&apos;instant : il arrive dès qu&apos;un script est validé en V2.</p>
      ) : (
        <AudioBrowser plans={plans} regeneration={regenerationAvailability(names.tts)} />
      )}
    </Card>
  );
}
