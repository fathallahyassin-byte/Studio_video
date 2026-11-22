import { Panel as Card } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getDb } from "@/lib/db";
import { DossierBrowser } from "./DossierBrowser";
import { loadDossierOverview } from "./loadDossiers";

// Panneau de /agents/03-recherchiste : dossiers récents, détail d'un dossier, filtre « faits faibles ».

export async function Panel() {
  const channel = await requireCurrentChannel();
  const { dossiers, researching, unreadable } = await loadDossierOverview(getDb(), channel.id);

  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-[750] text-ink">
          Dossiers de recherche
        </h2>
        <p className="mt-1 text-muted">
          {researching > 0 ? `${researching} vidéo(s) en cours de recherche. ` : ""}
          Un fait de confiance faible est interdit dans le script.
          {unreadable > 0 ? ` ${unreadable} dossier(s) illisible(s) masqué(s).` : ""}
        </p>
      </div>
      {dossiers.length === 0 ? (
        <p className="text-muted">Aucun dossier pour l&apos;instant : ils arrivent dès qu&apos;une idée est validée en V1.</p>
      ) : (
        <DossierBrowser dossiers={dossiers} />
      )}
    </Card>
  );
}
