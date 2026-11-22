import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { formatInteger, formatPercent, formatRelative, formatVideoNumber } from "@/lib/dashboard/format";
import { getStatsData } from "@/lib/dashboard/queries";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Statistiques · Studio" };

const confidenceLabels = { faible: "confiance faible", moyenne: "confiance moyenne", forte: "confiance forte" } as const;
const verdictLabels = { continuer: "Continuer", ajuster: "Ajuster", pivoter: "Pivoter" } as const;
const cell = "px-[18px] py-3.5";

export default async function StatsPage() {
  const channel = await requireCurrentChannel();
  const { rows, report, reportDate } = await getStatsData(getDb(), channel.id);

  return (
    <>
      <PageHeader title="Statistiques" description="Dernier relevé par vidéo et par plateforme. L'import automatique arrive avec les API des plateformes (étape 8)." />

      {rows.length === 0 ? (
        <Panel>
          <p className="text-muted">Aucune statistique pour l&apos;instant : elles apparaîtront après les premières publications.</p>
        </Panel>
      ) : (
        <div className="relative overflow-x-auto rounded-[20px] bg-white shadow-[inset_0_0_0_1px_var(--color-line)]">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">Statistiques par vidéo et par plateforme</caption>
            <thead>
              <tr className="text-left text-muted">
                <th scope="col" className={`${cell} font-bold`}>Vidéo</th>
                <th scope="col" className={`${cell} font-bold`}>Plateforme</th>
                <th scope="col" className={`${cell} text-right font-bold`}>Vues</th>
                <th scope="col" className={`${cell} text-right font-bold`}>Vue complète</th>
                <th scope="col" className={`${cell} text-right font-bold`}>Partages</th>
                <th scope="col" className={`${cell} text-right font-bold`}>Abonnés gagnés</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.publicationId} className="border-t border-[#ECEDEA]">
                  <th scope="row" className={`${cell} text-left font-semibold text-ink`}>
                    <span className="mr-2 text-xs font-normal text-muted">{formatVideoNumber(row.videoNumber)}</span>
                    {row.title}
                  </th>
                  <td className={cell}>{row.platform}</td>
                  <td className={`${cell} text-right tabular-nums`}>{formatInteger(row.views)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{formatPercent(row.completionRate)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{formatInteger(row.shares)}</td>
                  <td className={`${cell} text-right tabular-nums`}>{formatInteger(row.followersGained)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="learnings" className="rounded-[20px] bg-ink px-5 py-6 text-white sm:px-7">
        <h2 id="learnings" className="text-[13px] font-bold text-wait">
          Enseignements de l&apos;analyste
          {report && reportDate ? <span className="font-normal text-[#C9CBCE]"> · {report.periode}, {formatRelative(reportDate, new Date())}</span> : null}
        </h2>
        {report ? (
          <>
            <ul className="mt-2.5 flex list-disc flex-col gap-1.5 pl-[18px]">
              {report.enseignements.map((learning) => (
                <li key={learning.observation}>
                  {learning.observation} <span className="text-[13px] text-[#C9CBCE]">({confidenceLabels[learning.confiance]}, {learning.nb_videos} vidéo{learning.nb_videos > 1 ? "s" : ""})</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-[#C9CBCE]">
              <span className="font-bold text-white">Niche : {verdictLabels[report.verdict_niche]}.</span> {report.justification}
            </p>
          </>
        ) : (
          <p className="mt-2.5 text-[#C9CBCE]">Pas encore de rapport : l&apos;analyste (agent 10) tourne chaque lundi une fois les statistiques importées.</p>
        )}
      </section>
    </>
  );
}
