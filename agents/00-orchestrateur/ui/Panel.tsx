import Link from "next/link";
import { buttonClass, Chip, Panel as Card } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getDb } from "@/lib/db";
import { loadOrchestratorOverview } from "./load";
import { ActivationSwitch, AnswerForm } from "./PanelForms";
import { LOG_LIMIT, type BlockedVideoView, type LogEntryView, type ProposalView } from "./view";

// Panneau de /agents/00-orchestrateur : interrupteur, vidéos bloquées (question + réponse), propositions, journal.

const textWrap = "[overflow-wrap:anywhere]";

export async function Panel() {
  const channel = await requireCurrentChannel();
  const { active, log, blocked, proposals } = await loadOrchestratorOverview(getDb(), channel.id);

  return (
    <>
      <Card className="flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-[750] text-ink">Pilotage</h2>
          <p className="mt-1 text-muted">Facultatif : la machine à états fait déjà avancer les vidéos. L&apos;orchestrateur propose, elle décide.</p>
        </div>
        <ActivationSwitch active={active} />
      </Card>
      <BlockedVideos blocked={blocked} />
      {proposals.length > 0 ? <Proposals proposals={proposals} /> : null}
      <ProductionLog log={log} />
    </>
  );
}

function BlockedVideos({ blocked }: { blocked: BlockedVideoView[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-[750] text-ink">Vidéos bloquées</h2>
      {blocked.length === 0 ? (
        <p className="text-muted">Aucune vidéo bloquée : rien n&apos;attend ta réponse.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {blocked.map((video) => (
            <li key={video.videoId} className="flex flex-col gap-3 rounded-2xl bg-wait p-4 text-ink">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-bold ${textWrap}`}>{video.label}</span>
                <Chip tone="ok">{video.stageLabel}</Chip>
              </div>
              <div>
                <p className="text-[13px] font-bold">{video.source === "orchestrateur" ? "Question de l'orchestrateur" : "Raison du blocage"}</p>
                <p className={`mt-1 whitespace-pre-line ${textWrap}`}>{video.question}</p>
              </div>
              <AnswerForm videoId={video.videoId} />
              <Link href={`/validations?item=${video.videoId}`} className={`${buttonClass("ghost")} self-start`}>
                Autres choix dans Validations
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Proposals({ proposals }: { proposals: ProposalView[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-[750] text-ink">Dernières propositions</h2>
        <p className="mt-1 text-muted">Des conseils, jamais appliqués d&apos;office : les étapes et les validations restent à la machine à états et à toi.</p>
      </div>
      <ul className="flex flex-col gap-3">
        {proposals.map((proposal) => (
          <li key={proposal.key} className="flex flex-col gap-2 rounded-2xl bg-paper p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`font-bold text-ink ${textWrap}`}>{proposal.video}</span>
              <Chip tone="run">{proposal.status}</Chip>
              <Chip tone={proposal.conform ? "ok" : "run"}>{proposal.conform ? "Dernier livrable conforme" : "Corrections listées"}</Chip>
              <span className="text-[13px] text-muted">{proposal.dateLabel}</span>
            </div>
            <p className={textWrap}>
              <span className="font-bold text-ink">→ {proposal.target} : </span>
              {proposal.instruction}
            </p>
            {proposal.problems.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px]">
                {proposal.problems.map((problem, index) => (
                  <li key={`${index}-${problem}`} className={textWrap}>
                    {problem}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ProductionLog({ log }: { log: LogEntryView[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-[750] text-ink">Journal de production</h2>
        <p className="mt-1 text-muted">Les {LOG_LIMIT} dernières actions : changements d&apos;étape et passages des agents.</p>
      </div>
      {log.length === 0 ? (
        <p className="text-muted">Aucune action pour l&apos;instant.</p>
      ) : (
        <ol className="flex flex-col">
          {log.map((entry) => (
            <li key={entry.key} className="grid gap-x-4 gap-y-0.5 border-t border-[#ECEDEA] py-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)_10rem_minmax(0,1.4fr)]">
              <time dateTime={entry.dateIso} className="tabular-nums text-muted">
                {entry.dateLabel}
              </time>
              <span className={`font-bold text-ink ${textWrap}`}>{entry.video}</span>
              <span className={textWrap}>{entry.agent}</span>
              <span className={textWrap}>{entry.action}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
