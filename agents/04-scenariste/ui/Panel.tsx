import { Panel as Card } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getDb } from "@/lib/db";
import { wordBounds, type ScriptTarget } from "../rules";
import { loadScriptOverview } from "./loadScripts";
import { ScriptBrowser } from "./ScriptBrowser";
import { formatSeconds } from "./scripts";

// Panneau de /agents/04-scenariste : scripts récents et leur statut V2, détail d'un script.

function TargetLine({ target }: { target: ScriptTarget | null }) {
  if (!target) return <>Aucune bible lisible : la durée cible est inconnue.</>;
  const bounds = wordBounds(target);
  return (
    <>
      Cible de la bible : {formatSeconds(target.durationS)} s ({target.minDurationS} à {target.maxDurationS} s) à{" "}
      {String(target.wordsPerSecond).replace(".", ",")} mots/s, soit {bounds.min} à {bounds.max} mots.
    </>
  );
}

export async function Panel() {
  const channel = await requireCurrentChannel();
  const { scripts, writing, unreadable, target } = await loadScriptOverview(getDb(), channel);

  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-[750] text-ink">Scripts</h2>
        <p className="mt-1 text-muted">
          {writing > 0 ? `${writing} script(s) en cours d'écriture. ` : ""}
          <TargetLine target={target} />
          {unreadable > 0 ? ` ${unreadable} script(s) illisible(s) masqué(s).` : ""}
        </p>
      </div>
      {scripts.length === 0 ? (
        <p className="text-muted">Aucun script pour l&apos;instant : ils arrivent dès qu&apos;un dossier de recherche est prêt.</p>
      ) : (
        <ScriptBrowser scripts={scripts} />
      )}
    </Card>
  );
}
