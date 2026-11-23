import { Chip, Panel as Card } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getDb } from "@/lib/db";
import { BiblePreview } from "./BiblePreview";
import { CandidateTable } from "./CandidateTable";
import { loadStrategyPage, type StrategyResult } from "./loadStrategy";
import { StrategyForm } from "./StrategyForm";
import type { JobStatusView, StrategyView } from "./view";

// Panneau de /agents/01-strategiste-niche : formulaire, dernière analyse (niches, top 3,
// recommandation, plan de test) et bible proposée à adopter.

const textWrap = "[overflow-wrap:anywhere]";

export async function Panel() {
  const channel = await requireCurrentChannel();
  const data = await loadStrategyPage(getDb(), channel.id);

  return (
    <>
      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-[750] text-ink">Analyse des niches</h2>
          <p className="max-w-[70ch] text-muted">
            Au lancement de la chaîne, puis une fois par mois. Le stratège note une douzaine de niches sur 7 critères, recommande une niche et rédige sa bible : elle reste un
            brouillon tant que tu ne l&apos;adoptes pas.
          </p>
        </div>
        {data.job ? <JobStatus job={data.job} /> : null}
        {data.unreadable ? <p className="text-[13px] text-muted">La dernière sortie enregistrée ne respecte plus le schéma actuel : elle est masquée.</p> : null}
        <StrategyForm defaults={data.defaults} />
      </Card>
      {data.result ? <Result result={data.result} /> : <EmptyResult />}
    </>
  );
}

function JobStatus({ job }: { job: JobStatusView }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-[14px]">
      <Chip tone={job.tone}>{job.label}</Chip>
      <span className={`text-text ${textWrap}`}>{job.message}</span>
    </div>
  );
}

function EmptyResult() {
  return (
    <Card>
      <p className="text-muted">Aucune analyse pour l&apos;instant : remplis le formulaire puis lance l&apos;analyse. Le worker doit tourner (npm run worker).</p>
    </Card>
  );
}

function Result({ result }: { result: StrategyResult }) {
  const { view } = result;
  return (
    <>
      <Card className="flex flex-col gap-5">
        <Recommendation view={view} createdLabel={result.createdLabel} />
        <TestPlan view={view} />
      </Card>
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-[750] text-ink">Niches candidates</h2>
          <p className="mt-1 text-[13px] text-muted">
            Triées par score pondéré, recalculé en code (demande, faisabilité IA et profondeur ×2 ; monétisation, risque et différenciation ×1,5 ; concurrence ×1).
            Survole ou sélectionne une note pour lire sa justification.
          </p>
        </div>
        <CandidateTable candidates={view.candidates} maxScoreLabel={view.maxScoreLabel} />
      </Card>
      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-[750] text-ink">Top 3</h2>
        <Top3 view={view} />
      </Card>
      <Card>
        <BiblePreview bible={result.bible} />
      </Card>
    </>
  );
}

function Recommendation({ view, createdLabel }: { view: StrategyView; createdLabel: string }) {
  const { recommendation } = view;
  return (
    <section aria-labelledby="recommandation" className="flex flex-col gap-2">
      <p id="recommandation" className="text-[13px] font-bold text-muted">
        Recommandation · analyse du {createdLabel}
      </p>
      <p className={`font-display text-[28px] leading-tight sm:text-[32px] ${textWrap}`}>{recommendation.niche}</p>
      <p className={`max-w-[75ch] text-text ${textWrap}`}>{recommendation.why}</p>
      <h3 className="mt-2 text-[15px] font-[750] text-ink">Risques</h3>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {recommendation.risks.map((risk, index) => (
          <li key={`${index}-${risk}`} className={textWrap}>
            {risk}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TestPlan({ view }: { view: StrategyView }) {
  return (
    <section aria-labelledby="plan-de-test" className="flex flex-col gap-1 rounded-2xl bg-paper p-4">
      <h3 id="plan-de-test" className="text-[15px] font-[750] text-ink">
        Plan de test : {view.plan.summary}
      </h3>
      <p className={textWrap}>
        <span className="font-bold">Critère de validation :</span> {view.plan.criterion}
      </p>
    </section>
  );
}

function Top3({ view }: { view: StrategyView }) {
  return (
    <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-4">
      {view.top3.map((entry) => (
        <li key={entry.niche} className="flex flex-col gap-3 rounded-2xl bg-paper p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-bold text-ink ${textWrap}`}>{entry.niche}</span>
            <span className="text-[13px] text-muted tabular-nums">{entry.scoreLabel} pts</span>
            {entry.recommended ? <Chip tone="ok">Recommandée</Chip> : null}
          </div>
          <div>
            <h3 className="text-[13px] font-bold text-ink">10 titres d&apos;exemple</h3>
            <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-[14px]">
              {entry.titles.map((title, index) => (
                <li key={`${index}-${title}`} className={textWrap}>
                  {title}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="text-[13px] font-bold text-ink">À étudier</h3>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[14px]">
              {entry.toStudy.map((item, index) => (
                <li key={`${index}-${item}`} className={textWrap}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}
