import Link from "next/link";
import { buttonClass, Chip, Panel as Card } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getDb } from "@/lib/db";
import { renderAvailability } from "../render";
import { loadTimelineOverview } from "./loadTimelines";
import { TimelineBrowser } from "./TimelineBrowser";
import type { PendingEditView } from "./timelines";

// Panneau de /agents/07-monteur : montages en attente (ce qui manque), puis timelines récentes sur une frise.

const textWrap = "[overflow-wrap:anywhere]";

export async function Panel() {
  const channel = await requireCurrentChannel();
  const { timelines, pending, unreadable } = await loadTimelineOverview(getDb(), channel.id);
  const render = renderAvailability();

  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-[750] text-ink">Timelines</h2>
        <p className="mt-1 text-muted">
          Sous-titres recalés en code sur l&apos;horodatage de la voix ; format 1080×1920 à 30 i/s, fin au plus 0,5 s après le dernier mot.
          {unreadable > 0 ? ` ${unreadable} timeline(s) illisible(s) masquée(s).` : ""}
        </p>
      </div>
      {pending.length > 0 ? <PendingEdits pending={pending} /> : null}
      {timelines.length === 0 ? (
        <p className="text-muted">Aucune timeline pour l&apos;instant : le montage démarre quand le storyboard et le plan sonore sont prêts.</p>
      ) : (
        <TimelineBrowser timelines={timelines} render={render} />
      )}
    </Card>
  );
}

function PendingEdits({ pending }: { pending: PendingEditView[] }) {
  return (
    <section aria-label="Montages en attente" className="flex flex-col gap-2">
      <h3 className="text-[15px] font-[750] text-ink">Montages en attente</h3>
      <ul className="flex flex-col gap-2">
        {pending.map((edit) => (
          <li key={edit.videoId} className={`flex flex-col gap-2 rounded-2xl p-4 ${edit.waiting ? "bg-wait text-ink" : "bg-paper text-text"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-bold ${textWrap}`}>
                {edit.label} · {edit.title}
              </span>
              <Chip tone={edit.waiting ? "ok" : "run"}>{edit.waiting ? "Il manque des éléments" : "Montage en cours"}</Chip>
            </div>
            {edit.issues.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px]">
                {edit.issues.map((issue) => (
                  <li key={issue} className={textWrap}>
                    {issue}
                  </li>
                ))}
              </ul>
            ) : null}
            {edit.blocked ? (
              <Link href={`/validations?item=${edit.videoId}`} className={`${buttonClass("ink")} self-start`}>
                Ouvrir dans Validations
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
