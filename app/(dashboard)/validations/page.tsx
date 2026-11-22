import type { Metadata } from "next";
import Link from "next/link";
import { Chip, PageHeader, Panel } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import type { Stage } from "@/lib/generated/prisma/client";
import { stageLabels } from "@/lib/pipeline/machine";
import { ScoutForm } from "../production/ProductionActions";
import { FixForm, IdeasDecisionForm, VideoDecisionForm } from "./DecisionForms";
import { doneMessage } from "./messages";
import { formatRelative, formatVideoNumber } from "@/lib/dashboard/format";
import type { QaReport } from "@/lib/dashboard/payloads";
import { ScriptReview } from "@/agents/04-scenariste/ui/ScriptParts";
import { qaCheckLabel, qaDecisionLabels, qaStatusLabels } from "@/lib/dashboard/qaChecklist";
import { getQueueDetail, getValidationData, type IdeaRow, type QueueDetail } from "@/lib/dashboard/queries";
import { selectQueueItem } from "@/lib/dashboard/queue";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "À valider · Studio" };

function Unreadable() {
  return <p className="rounded-xl bg-paper p-4 text-sm text-muted">Le livrable de l&apos;agent est illisible ou absent : relance l&apos;agent depuis sa page.</p>;
}

function IdeasDetail({ ideas }: { ideas: IdeaRow[] }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-bold text-ink">Idées à produire</legend>
      <ul className="flex flex-col">
        {ideas.map((idea) => (
          <li key={idea.videoId} className="flex items-center gap-3.5 border-t border-[#ECEDEA] py-3">
            <input type="checkbox" id={`idea-${idea.videoId}`} name="ideas" value={idea.videoId} className="size-5 shrink-0 accent-ink" />
            <label htmlFor={`idea-${idea.videoId}`} className="flex flex-1 flex-col">
              <span className="font-semibold text-ink">{idea.title}</span>
              {idea.hook ? <span className="text-[13px] text-muted">{idea.hook}</span> : null}
            </label>
            {idea.hypothesis ? <Chip tone="run">hypothèse</Chip> : null}
            <span className="text-[13px] font-bold text-ink tabular-nums">
              <span className="sr-only">Score : </span>
              {idea.score === null ? "—" : idea.score.toFixed(1).replace(".", ",")}
            </span>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function QaDetail({ report }: { report: QaReport }) {
  const labels = [
    { label: "TikTok : contenu IA", on: report.etiquettes.tiktok_contenu_ia },
    { label: "Instagram : contenu IA", on: report.etiquettes.instagram_contenu_ia },
    { label: "YouTube : utilisation de l'IA", on: report.etiquettes.youtube_utilisation_ia },
    { label: "Contenu de marque", on: report.etiquettes.contenu_de_marque },
  ];
  return (
    <div className="flex flex-col gap-5">
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
        <span className="font-bold">Décision du contrôle :</span>
        <Chip tone={report.decision === "GO" ? "ok" : "wait"}>{qaDecisionLabels[report.decision]}</Chip>
      </p>
      <p className="whitespace-pre-line text-sm text-text">{report.resume_pour_humain}</p>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-2">
        {report.controles.map((check) => (
          <li key={check.id} className="flex flex-col gap-1 rounded-[10px] bg-paper px-3 py-2.5">
            <span className="flex items-center gap-2.5">
              <Chip tone={check.statut === "ko" ? "wait" : check.statut === "ok" ? "ok" : "run"}>{qaStatusLabels[check.statut]}</Chip>
              <span className="text-ink">{qaCheckLabel(check.id)}</span>
            </span>
            {check.statut === "ko" && check.correction ? <span className="text-xs text-muted">{check.correction}</span> : null}
          </li>
        ))}
      </ul>
      <div>
        <h3 className="mb-2 text-[13px] font-bold text-ink">Étiquettes appliquées à la publication</h3>
        <ul className="flex flex-wrap gap-2">
          {labels.map((item) => (
            <li key={item.label}>
              <Chip tone={item.on ? "wait" : "run"}>
                {item.label} : {item.on ? "à activer" : "non"}
              </Chip>
            </li>
          ))}
        </ul>
        {report.mentions_a_incruster.length > 0 ? (
          <p className="mt-2 text-sm text-text">Mentions à incruster : {report.mentions_a_incruster.join(", ")}</p>
        ) : null}
      </div>
    </div>
  );
}

function FixDetail({ reason, blockedAt }: { reason: string | null; blockedAt: Stage | null }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-paper p-4 text-sm">
      <p>
        <span className="font-bold text-ink">Étape bloquée : </span>
        {blockedAt ? stageLabels[blockedAt] : "inconnue"}
      </p>
      <p className="whitespace-pre-line text-text">{reason ?? "Aucune raison enregistrée."}</p>
      <p className="text-muted">« Relancer l&apos;étape » remet la vidéo à cette étape et relance son agent, avec ta note.</p>
    </div>
  );
}

function DetailBody({ detail }: { detail: QueueDetail }) {
  switch (detail.kind) {
    case "ideas":
      return (
        <IdeasDecisionForm>
          <IdeasDetail ideas={detail.ideas} />
        </IdeasDecisionForm>
      );
    case "script":
      return (
        <>
          {detail.review ? <ScriptReview content={detail.review} headingLevel="h3" /> : <Unreadable />}
          <VideoDecisionForm videoId={detail.videoId} gate="V2" />
        </>
      );
    case "qa":
      return (
        <>
          {detail.report ? <QaDetail report={detail.report} /> : <Unreadable />}
          <VideoDecisionForm videoId={detail.videoId} gate="V3" suggestedReturn={detail.suggestedReturn} />
        </>
      );
    case "fix":
      return (
        <>
          <FixDetail reason={detail.reason} blockedAt={detail.blockedAt} />
          <FixForm videoId={detail.videoId} sources={detail.blockedAt === "RESEARCH" ? detail.sources : undefined} />
        </>
      );
  }
}

type ValidationsPageProps = { searchParams: Promise<{ item?: string | string[]; fait?: string | string[] }> };

export default async function ValidationsPage({ searchParams }: ValidationsPageProps) {
  const { item: requested, fait } = await searchParams;
  const done = doneMessage(fait);
  const channel = await requireCurrentChannel();
  const db = getDb();
  const { queue } = await getValidationData(db, channel.id);
  const selected = selectQueueItem(queue, typeof requested === "string" ? requested : undefined);
  const detail = selected ? await getQueueDetail(db, selected) : null;
  const now = new Date();

  return (
    <>
      <PageHeader title="À valider" description="Les trois moments où l'équipe t'attend : V1 les idées, V2 le script, V3 le GO final. Et les vidéos bloquées à corriger." />
      {done ? (
        <p role="status" className="rounded-[14px] bg-ink px-4 py-3 font-semibold text-white">
          {done}
        </p>
      ) : null}

      {!selected || !detail ? (
        <Panel className="flex flex-col items-start gap-5 sm:p-10">
          <div>
            <p className="font-display text-[30px]">Rien à valider.</p>
            <p className="mt-2 text-muted">L&apos;équipe produit. Lance la veille pour recevoir de nouvelles idées.</p>
          </div>
          <ScoutForm />
        </Panel>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <nav aria-label="File de validation" className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5">
            {queue.map((item) => {
              const current = item.key === selected.key;
              return (
                <Link
                  key={item.key}
                  href={`/validations?item=${item.key}`}
                  aria-current={current ? "page" : undefined}
                  className={`flex flex-col items-start gap-1 rounded-[14px] bg-white px-4 py-3.5 transition-shadow duration-150 ${
                    current ? "shadow-[inset_0_0_0_2px_#000,0_0_0_4px_var(--color-wait)]" : "shadow-[inset_0_0_0_1px_var(--color-line)] hover:shadow-[inset_0_0_0_2px_#000]"
                  }`}
                >
                  <Chip tone="wait">{item.gateShort}</Chip>
                  <span className="leading-[1.3] font-bold text-ink">{item.title}</span>
                  <span className="text-[13px] text-muted">
                    {item.agentName}, {formatRelative(item.since, now)}
                  </span>
                </Link>
              );
            })}
          </nav>

          <Panel className="flex min-w-0 flex-[2_1_460px] flex-col gap-5">
            <div>
              <Chip tone="wait">{selected.gateLabel}</Chip>
              <h2 className="font-display mt-3 text-[28px] sm:text-[32px]">{selected.title}</h2>
              <p className="mt-1.5 text-muted">
                {selected.agentName}, {formatRelative(selected.since, now)}
                {selected.videoNumber !== null ? ` · ${formatVideoNumber(selected.videoNumber)}` : ""}
              </p>
            </div>
            <DetailBody key={selected.key} detail={detail} />
          </Panel>
        </div>
      )}
    </>
  );
}
