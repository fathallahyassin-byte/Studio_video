import Link from "next/link";
import type { AgentPanelProps } from "@/agents/_shared/types";
import { Chip, Panel as Card } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { formatDateTime, formatVideoNumber } from "@/lib/dashboard/format";
import { getDb } from "@/lib/db";
import type { JobStatus } from "@/lib/generated/prisma/client";
import { stageLabels } from "@/lib/pipeline/machine";
import { loadScoutPanel, type LastScout, type ScoutIdeaRow, type ScoutJobState } from "./queries";
import { LaunchScoutForm, SignalsForm } from "./ScoutForms";

const jobStatusLabels: Record<JobStatus, string> = {
  QUEUED: "en file",
  RUNNING: "en cours",
  DONE: "terminée",
  FAILED: "échouée",
};

const sectionTitle = "text-lg font-[750] text-ink";

function formatScore(score: number): string {
  return score.toFixed(1).replace(".", ",");
}

function JobLine({ job }: { job: ScoutJobState | null }) {
  if (!job) return <p className="text-sm text-muted">Aucune veille lancée pour l&apos;instant.</p>;
  return (
    <p className="text-sm text-muted">
      Dernière tâche <code className="font-mono">{job.jobKey.split(":").at(-1)}</code> : {jobStatusLabels[job.status]} (créée le {formatDateTime(job.createdAt)})
      {job.status === "FAILED" && job.lastError ? ` — ${job.lastError}` : ""}
    </p>
  );
}

function StageChip({ video }: { video: ScoutIdeaRow["video"] }) {
  if (!video) return <Chip tone="run">Vidéo non créée</Chip>;
  const number = formatVideoNumber(video.number);
  if (video.stage === "AWAITING_V1") {
    return (
      <Link href="/validations?item=v1" className="rounded-full">
        <Chip tone="wait">{number} · À trier (V1)</Chip>
      </Link>
    );
  }
  return <Chip tone={video.stage === "REJECTED" ? "run" : "ok"}>{`${number} · ${stageLabels[video.stage]}`}</Chip>;
}

function IdeaItem({ idea }: { idea: ScoutIdeaRow }) {
  const { notes } = idea;
  return (
    <li className="flex gap-4 border-t border-line py-4 first:border-t-0 first:pt-0">
      <p className="font-display w-14 shrink-0 text-[28px] tabular-nums" aria-label={`Score ${formatScore(idea.score)}`}>
        {formatScore(idea.score)}
      </p>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="font-bold text-ink">{idea.angle}</p>
        <p className="text-sm">{idea.accroche}</p>
        <p className="text-[13px] text-muted">
          {idea.pilier} · {idea.format} · {idea.pourquoi_maintenant}
        </p>
        <p className="text-[13px] text-muted tabular-nums">
          Accroche {notes.accroche} · Intérêt {notes.interet} · Originalité {notes.originalite} · Visuel {notes.faisabilite_visuelle} · Vérifiabilité{" "}
          {notes.verifiabilite}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <StageChip video={idea.video} />
          {idea.hypothese ? <Chip tone="run">hypothèse</Chip> : null}
          {idea.procheDe ? <Chip tone="run">proche de « {idea.procheDe} »</Chip> : null}
        </div>
      </div>
    </li>
  );
}

function SeriesAndDiscarded({ scout }: { scout: LastScout }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-5">
      <Card className="flex flex-col gap-4">
        <h3 className={sectionTitle}>Séries proposées</h3>
        {scout.series.length === 0 ? <p className="text-muted">Aucune série.</p> : null}
        <ul className="flex flex-col gap-4">
          {scout.series.map((serie, index) => (
            <li key={`${index}-${serie.titre}`}>
              <p className="font-bold text-ink">{serie.titre}</p>
              <ol className="mt-1 list-decimal pl-5 text-sm">
                {serie.episodes.map((episode, episodeIndex) => (
                  <li key={`${episodeIndex}-${episode}`}>{episode}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex flex-col gap-4">
        <h3 className={sectionTitle}>Idées écartées</h3>
        {scout.discarded.length === 0 ? <p className="text-muted">Aucune idée écartée.</p> : null}
        <ul className="flex flex-col gap-3">
          {scout.discarded.map((entry, index) => (
            <li key={`${index}-${entry.idee}`}>
              <p className="font-bold text-ink">{entry.idee}</p>
              <p className="text-sm text-muted">Raison : {entry.raison}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function LastScoutSection({ scout }: { scout: LastScout | null }) {
  if (!scout) {
    return (
      <Card>
        <h3 className={sectionTitle}>Dernière veille</h3>
        <p className="mt-2 text-muted">Pas encore de veille réussie : les 20 idées notées apparaîtront ici.</p>
      </Card>
    );
  }
  return (
    <>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className={sectionTitle}>Dernière veille · {scout.week}</h3>
          <p className="text-[13px] text-muted">
            {scout.ideas.length} idées triées par score · {formatDateTime(scout.createdAt)}
          </p>
        </div>
        <ol aria-label="Idées de la dernière veille, par score décroissant">
          {scout.ideas.map((idea) => (
            <IdeaItem key={idea.id} idea={idea} />
          ))}
        </ol>
      </Card>
      <SeriesAndDiscarded scout={scout} />
    </>
  );
}

export async function Panel({ agentId }: AgentPanelProps) {
  const channel = await requireCurrentChannel();
  const data = await loadScoutPanel(getDb(), channel.id);
  return (
    <section aria-label={`Panneau de l'agent ${agentId} · Veilleur`} className="flex flex-col gap-5">
      <Card className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-6">
        <SignalsForm signals={data.signals.text} />
        <div className="flex flex-col gap-3">
          <h3 className={sectionTitle}>Veille de la semaine</h3>
          <p className="text-sm text-muted">
            Lancée automatiquement le lundi à 7 h, une fois par semaine. Les idées arrivent dans « À valider » (V1).
            {data.signals.updatedAt ? ` Signaux mis à jour le ${formatDateTime(new Date(data.signals.updatedAt))}.` : ""}
          </p>
          <LaunchScoutForm />
          <JobLine job={data.lastJob} />
        </div>
      </Card>
      <LastScoutSection scout={data.lastScout} />
    </section>
  );
}
