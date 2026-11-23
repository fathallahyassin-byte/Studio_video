import { Chip, Panel as Card } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getDb } from "@/lib/db";
import { ApplyToBibleForm, ExperimentForm, LaunchAnalysisForm } from "./AnalystForms";
import { loadPanelInput } from "./loadAnalysis";
import { buildPanelView, type ExperimentView, type RankedView, type ReportView, type StatusView } from "./view";

// Panneau de /agents/10-analyste : dernier rapport, expériences, verdict sur la niche, « Appliquer à la bible ».
// Le jaune ne sert qu'à ce qui attend l'humain (expérience à lancer, apprentissages à appliquer, analyse bloquée).

const textWrap = "[overflow-wrap:anywhere]";

export async function Panel() {
  const channel = await requireCurrentChannel();
  const view = buildPanelView(await loadPanelInput(getDb(), channel.id, new Date()));

  return (
    <Card className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-[750] text-ink">Rapport de la semaine</h2>
          <p className="mt-1 max-w-[70ch] text-muted">
            Chaque lundi à 6 h. Médianes par plateforme et écarts calculés en code ; vidéos publiées depuis moins de 72 h exclues des comparaisons.
          </p>
        </div>
        <LaunchAnalysisForm />
      </div>
      <AnalysisStatus status={view.status} />
      {view.report ? (
        <ReportSections report={view.report} hasActiveBible={view.hasActiveBible} />
      ) : (
        <EmptyReport unreadable={view.unreadableReport} />
      )}
      <Experiments experiments={view.experiments} />
    </Card>
  );
}

function AnalysisStatus({ status }: { status: StatusView }) {
  if (!status) return null;
  return (
    <p role="status" className={`rounded-xl px-4 py-3 text-sm font-semibold ${textWrap} ${status.waiting ? "bg-wait text-ink" : "bg-paper text-text"}`}>
      {status.message}
    </p>
  );
}

function EmptyReport({ unreadable }: { unreadable: boolean }) {
  if (unreadable) return <p className="text-muted">Le dernier rapport est illisible (format ancien) : lance une nouvelle analyse.</p>;
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-paper p-5">
      <p className="font-display text-[24px]">Pas encore de statistiques à analyser.</p>
      <p className="max-w-[65ch] text-muted">
        L&apos;analyste a besoin d&apos;au moins une vidéo publiée depuis plus de 72 h, avec des statistiques importées. Tant qu&apos;il n&apos;y en a pas, il
        n&apos;appelle pas le modèle : aucun chiffre n&apos;est inventé. L&apos;import automatique des statistiques arrive avec les API des plateformes.
      </p>
    </div>
  );
}

function ReportSections({ report, hasActiveBible }: { report: ReportView; hasActiveBible: boolean }) {
  return (
    <>
      <section aria-labelledby="analyst-summary" className="flex flex-col gap-2">
        <h3 id="analyst-summary" className="text-[15px] font-[750] text-ink">
          {report.period} <span className="font-normal text-muted">· {report.dateLabel}</span>
        </h3>
        <p className={`whitespace-pre-line ${textWrap}`}>{report.summary}</p>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <RankedList id="analyst-top" title="Top" entries={report.top} empty="Aucune vidéo au-dessus de la médiane." />
        <RankedList id="analyst-flop" title="Flop" entries={report.flop} empty="Pas assez de vidéos comparables pour un flop." />
      </div>
      <Learnings report={report} />
      <section aria-labelledby="analyst-niche" className="flex flex-col gap-2 rounded-2xl bg-ink p-5 text-white">
        <h3 id="analyst-niche" className="text-[13px] font-bold text-[#C9CBCE]">
          Verdict sur la niche
        </h3>
        <p className="font-display text-[28px]">{report.verdictLabel}</p>
        <p className={`text-[15px] text-[#E4E5E2] ${textWrap}`}>{report.justification}</p>
      </section>
      {report.backlog.length > 0 ? <Backlog groups={report.backlog} /> : null}
      {report.bibleUpdates.length > 0 ? (
        <ApplyToBibleForm reportId={report.id} lines={report.bibleUpdates} appliedVersion={report.appliedVersion} hasActiveBible={hasActiveBible} />
      ) : (
        <p className="text-[13px] text-muted">Aucun apprentissage proposé pour la bible cette semaine.</p>
      )}
    </>
  );
}

function RankedList({ id, title, entries, empty }: { id: string; title: string; entries: RankedView[]; empty: string }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <h3 id={id} className="text-[15px] font-[750] text-ink">
        {title} {entries.length > 0 ? entries.length : ""}
      </h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.key} className="rounded-xl bg-paper px-4 py-3">
              <p className={`font-bold text-ink ${textWrap}`}>{entry.label}</p>
              <p className={`mt-0.5 text-sm ${textWrap}`}>{entry.reason}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Learnings({ report }: { report: ReportView }) {
  return (
    <section aria-labelledby="analyst-learnings" className="flex flex-col gap-2">
      <h3 id="analyst-learnings" className="text-[15px] font-[750] text-ink">
        Enseignements
      </h3>
      <ul className="flex flex-col gap-2">
        {report.learnings.map((learning) => (
          <li key={learning.key} className="flex flex-col gap-1.5 rounded-xl px-4 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <Chip tone={learning.tone}>{learning.detail}</Chip>
            <p className={textWrap}>{learning.observation}</p>
            <p className={`text-sm text-muted ${textWrap}`}>
              <span className="font-bold text-ink">Décision : </span>
              {learning.decision}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Backlog({ groups }: { groups: ReportView["backlog"] }) {
  return (
    <section aria-labelledby="analyst-backlog" className="flex flex-col gap-2">
      <h3 id="analyst-backlog" className="text-[15px] font-[750] text-ink">
        Backlog
      </h3>
      <dl className="grid gap-3 sm:grid-cols-3">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0">
            <dt className="text-[13px] font-bold text-muted">{group.label}</dt>
            <dd>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm">
                {group.items.map((item) => (
                  <li key={item} className={textWrap}>
                    {item}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Experiments({ experiments }: { experiments: ExperimentView[] }) {
  return (
    <section aria-labelledby="analyst-experiments" className="flex flex-col gap-2">
      <h3 id="analyst-experiments" className="text-[15px] font-[750] text-ink">
        Expériences
      </h3>
      {experiments.length === 0 ? (
        <p className="text-sm text-muted">Aucune expérience proposée ou en cours.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {experiments.map((experiment) => (
            <li key={experiment.id} className={`flex min-w-0 flex-col gap-2 rounded-2xl p-4 ${experiment.action === "launch" ? "bg-wait text-ink" : "bg-paper text-text"}`}>
              <Chip tone={experiment.action === "launch" ? "ok" : "run"}>{experiment.statusLabel}</Chip>
              <p className={`font-bold ${textWrap}`}>{experiment.hypothesis}</p>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt className="font-bold">Variable</dt>
                <dd className={textWrap}>{experiment.variable}</dd>
                <dt className="font-bold">Réussite si</dt>
                <dd className={textWrap}>{experiment.criterion}</dd>
              </dl>
              {experiment.action ? <ExperimentForm experimentId={experiment.id} action={experiment.action} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
