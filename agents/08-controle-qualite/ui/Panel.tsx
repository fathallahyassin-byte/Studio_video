import { Panel as Card } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getDb } from "@/lib/db";
import { loadReportOverview } from "./loadReports";
import { ReportBrowser } from "./ReportBrowser";

// Panneau de /agents/08-controle-qualite : rapports récents et leur décision, détail d'un rapport.

export async function Panel() {
  const channel = await requireCurrentChannel();
  const { reports, checking, unreadable } = await loadReportOverview(getDb(), channel.id);

  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-[750] text-ink">Rapports de contrôle</h2>
        <p className="mt-1 text-muted">
          Check-list A à F, étiquettes IA par plateforme et mentions à incruster. La décision est recalculée en code : la plus stricte l&apos;emporte.
          {checking > 0 ? ` ${checking} vidéo(s) en cours de contrôle.` : ""}
          {unreadable > 0 ? ` ${unreadable} rapport(s) illisible(s) masqué(s).` : ""}
        </p>
      </div>
      {reports.length === 0 ? (
        <p className="text-muted">Aucun rapport pour l&apos;instant : ils arrivent après le rendu de chaque vidéo.</p>
      ) : (
        <ReportBrowser reports={reports} />
      )}
    </Card>
  );
}
